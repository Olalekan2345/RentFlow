import {
  toMirrorTxId,
  hbarToTinybar,
  toBaseUnits,
  USDC_DECIMALS,
} from "@rentflow/shared";
import { config } from "./config.js";

/** Shape of the bits of a Mirror Node transaction we rely on. */
interface MirrorTransfer {
  account: string;
  amount: number;
}
interface MirrorTokenTransfer {
  token_id: string;
  account: string;
  amount: number;
}
interface MirrorTransaction {
  transaction_id: string;
  result: string;
  memo_base64?: string | null;
  consensus_timestamp?: string;
  transfers?: MirrorTransfer[];
  token_transfers?: MirrorTokenTransfer[];
}
interface MirrorResponse {
  transactions?: MirrorTransaction[];
}

export interface ExpectedPayment {
  asset: "HBAR" | "USDC";
  tokenId: string | null;
  /** Amount in display units (decimal string). */
  amount: string;
  payTo: string;
  /** The nonce that must appear in the memo. */
  paymentId: string;
}

export type VerifyResult =
  | { ok: true; payer: string; memo: string; consensusTimestamp: string }
  | { ok: false; reason: string; retryable: boolean };

/** Injectable fetch so tests can mock the Mirror Node REST call. */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * Verify a payment against the Hedera Mirror Node REST API. We NEVER trust the
 * client's claim — every field is checked against consensus data:
 *   1. transaction exists and result === SUCCESS
 *   2. the correct recipient received the correct amount (HBAR or HTS token)
 *   3. the memo contains the expected paymentId nonce
 *
 * Double-spend (a tx redeemed twice) is enforced separately at the DB layer.
 */
export async function verifyPaymentOnMirror(
  sdkTxId: string,
  expected: ExpectedPayment,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
): Promise<VerifyResult> {
  const mirrorId = toMirrorTxId(sdkTxId);
  const url = `${config.mirrorNodeUrl}/api/v1/transactions/${mirrorId}`;

  let res;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    return {
      ok: false,
      reason: `mirror node fetch failed: ${(err as Error).message}`,
      retryable: true,
    };
  }

  if (res.status === 404) {
    // Mirror nodes lag a few seconds behind consensus — tell the caller to retry.
    return { ok: false, reason: "transaction not yet on mirror node", retryable: true };
  }
  if (!res.ok) {
    return { ok: false, reason: `mirror node HTTP ${res.status}`, retryable: true };
  }

  const body = (await res.json()) as MirrorResponse;
  const tx = body.transactions?.[0];
  if (!tx) {
    return { ok: false, reason: "transaction not found on mirror node", retryable: true };
  }

  if (tx.result !== "SUCCESS") {
    return { ok: false, reason: `transaction result was ${tx.result}`, retryable: false };
  }

  // memo check
  const memo = tx.memo_base64
    ? Buffer.from(tx.memo_base64, "base64").toString("utf8")
    : "";
  if (!memo.includes(expected.paymentId)) {
    return {
      ok: false,
      reason: `memo does not contain paymentId ${expected.paymentId}`,
      retryable: false,
    };
  }

  // amount + recipient check
  if (expected.asset === "HBAR") {
    const need = hbarToTinybar(expected.amount);
    const credited = (tx.transfers ?? [])
      .filter((t) => t.account === expected.payTo && t.amount > 0)
      .reduce((sum, t) => sum + BigInt(t.amount), 0n);
    if (credited < need) {
      return {
        ok: false,
        reason: `underpaid: landlord ${expected.payTo} received ${credited} tinybar, needed ${need}`,
        retryable: false,
      };
    }
    const payer = payerFromTransfers(tx.transfers ?? []);
    return { ok: true, payer, memo, consensusTimestamp: tx.consensus_timestamp ?? "" };
  } else {
    if (!expected.tokenId) {
      return { ok: false, reason: "USDC settlement but no tokenId configured", retryable: false };
    }
    const need = toBaseUnits(expected.amount, USDC_DECIMALS);
    const credited = (tx.token_transfers ?? [])
      .filter(
        (t) =>
          t.token_id === expected.tokenId &&
          t.account === expected.payTo &&
          t.amount > 0,
      )
      .reduce((sum, t) => sum + BigInt(t.amount), 0n);
    if (credited < need) {
      return {
        ok: false,
        reason: `underpaid: landlord received ${credited} base units of ${expected.tokenId}, needed ${need}`,
        retryable: false,
      };
    }
    const payer = tokenPayer(tx.token_transfers ?? [], expected.tokenId);
    return { ok: true, payer, memo, consensusTimestamp: tx.consensus_timestamp ?? "" };
  }
}

function payerFromTransfers(transfers: MirrorTransfer[]): string {
  // The payer is the account with the most-negative HBAR delta.
  let payer = "";
  let min = 0n;
  for (const t of transfers) {
    const amt = BigInt(t.amount);
    if (amt < min) {
      min = amt;
      payer = t.account;
    }
  }
  return payer;
}

function tokenPayer(transfers: MirrorTokenTransfer[], tokenId: string): string {
  let payer = "";
  let min = 0n;
  for (const t of transfers) {
    if (t.token_id !== tokenId) continue;
    const amt = BigInt(t.amount);
    if (amt < min) {
      min = amt;
      payer = t.account;
    }
  }
  return payer;
}
