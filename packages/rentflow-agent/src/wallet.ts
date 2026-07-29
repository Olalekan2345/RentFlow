import {
  Client,
  AccountId,
  TokenId,
  Hbar,
  HbarUnit,
  TransferTransaction,
  AccountBalanceQuery,
  TokenAssociateTransaction,
  Status,
} from "@hashgraph/sdk";
import { parsePrivateKey } from "./keys.js";
import {
  hbarToTinybar,
  tinybarToHbar,
  toBaseUnits,
  fromBaseUnits,
  USDC_DECIMALS,
} from "@rentflow/shared";
import { config } from "./config.js";

const operatorId = AccountId.fromString(config.operatorId);
const operatorKey = parsePrivateKey(config.operatorKey);

export const client = Client.forName(config.network).setOperator(operatorId, operatorKey);

export interface Balance {
  /** HBAR balance as a decimal string. */
  hbar: string;
  /** Token balance as a decimal string, or null in HBAR mode. */
  token: string | null;
}

export async function getBalance(): Promise<Balance> {
  const bal = await new AccountBalanceQuery().setAccountId(operatorId).execute(client);
  const hbar = bal.hbars.to(HbarUnit.Hbar).toString();
  let token: string | null = null;
  if (config.usdcTokenId) {
    const raw = bal.tokens?.get(TokenId.fromString(config.usdcTokenId));
    token = raw ? fromBaseUnits(BigInt(raw.toString()), USDC_DECIMALS) : "0";
  }
  return { hbar, token };
}

/** The spendable balance in the settlement asset, as a decimal string. */
export async function settlementBalance(): Promise<string> {
  const bal = await getBalance();
  return config.asset === "USDC" ? bal.token ?? "0" : bal.hbar;
}

/**
 * Ensure the operator is associated with the HTS token before first transfer.
 * No-op in HBAR mode or if already associated.
 */
export async function ensureTokenAssociation(): Promise<boolean> {
  if (!config.usdcTokenId) return false;
  const tokenId = TokenId.fromString(config.usdcTokenId);
  const bal = await new AccountBalanceQuery().setAccountId(operatorId).execute(client);
  if (bal.tokens?.get(tokenId) !== undefined) return false; // already associated

  const tx = await new TokenAssociateTransaction()
    .setAccountId(operatorId)
    .setTokenIds([tokenId])
    .execute(client);
  const receipt = await tx.getReceipt(client);
  if (receipt.status !== Status.Success) {
    throw new Error(`token association failed: ${receipt.status.toString()}`);
  }
  return true;
}

export interface PaymentResult {
  txId: string;
  amount: string;
}

/**
 * Send one rent payment on Hedera testnet, stamping the paymentId memo.
 * Uses HBAR or HTS token transfer depending on configured asset.
 */
export async function payRent(
  payTo: string,
  amount: string,
  memo: string,
): Promise<PaymentResult> {
  const to = AccountId.fromString(payTo);
  let tx: TransferTransaction;

  if (config.asset === "USDC" && config.usdcTokenId) {
    const tokenId = TokenId.fromString(config.usdcTokenId);
    const base = toBaseUnits(amount, USDC_DECIMALS);
    tx = new TransferTransaction()
      .addTokenTransfer(tokenId, operatorId, -Number(base))
      .addTokenTransfer(tokenId, to, Number(base))
      .setTransactionMemo(memo);
  } else {
    const tinybar = hbarToTinybar(amount);
    tx = new TransferTransaction()
      .addHbarTransfer(operatorId, Hbar.fromTinybars(-tinybar))
      .addHbarTransfer(to, Hbar.fromTinybars(tinybar))
      .setTransactionMemo(memo);
  }

  const submitted = await tx.execute(client);
  const receipt = await submitted.getReceipt(client);
  if (receipt.status !== Status.Success) {
    throw new Error(`transfer failed on-chain: ${receipt.status.toString()}`);
  }
  return { txId: submitted.transactionId.toString(), amount };
}

export { tinybarToHbar };
