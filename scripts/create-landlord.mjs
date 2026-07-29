#!/usr/bin/env node
/**
 * Create + fund a landlord account on Hedera testnet from the agent wallet, then
 * write HEDERA_LANDLORD_ID / HEDERA_LANDLORD_KEY into .env. Idempotent: if the
 * landlord fields are already filled, it does nothing.
 *
 *   node scripts/create-landlord.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  Client,
  PrivateKey,
  AccountId,
  Hbar,
  AccountCreateTransaction,
} from "@hashgraph/sdk";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");
const envText = readFileSync(envPath, "utf8");

const env = Object.fromEntries(
  envText
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

if (env.HEDERA_LANDLORD_ID && env.HEDERA_LANDLORD_KEY) {
  console.log(`Landlord already set: ${env.HEDERA_LANDLORD_ID} — nothing to do.`);
  process.exit(0);
}

function parseKey(raw) {
  const s = raw.trim();
  const hex = s.startsWith("0x") ? s.slice(2) : s;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    if (s.startsWith("0x")) return PrivateKey.fromStringECDSA(hex);
    try { return PrivateKey.fromStringED25519(hex); } catch { return PrivateKey.fromStringECDSA(hex); }
  }
  return PrivateKey.fromStringDer(s);
}

const operatorId = AccountId.fromString(env.HEDERA_OPERATOR_ID);
const operatorKey = parseKey(env.HEDERA_OPERATOR_KEY);
const client = Client.forName(env.HEDERA_NETWORK || "testnet").setOperator(operatorId, operatorKey);

const INITIAL_FUNDING_HBAR = 20;

console.log(`Creating landlord account (funded ${INITIAL_FUNDING_HBAR} ℏ) from ${operatorId.toString()}...`);
const landlordKey = PrivateKey.generateED25519();
const tx = await new AccountCreateTransaction()
  .setKeyWithoutAlias(landlordKey.publicKey)
  .setInitialBalance(new Hbar(INITIAL_FUNDING_HBAR))
  .setAccountMemo("RentFlow landlord")
  .execute(client);
const receipt = await tx.getReceipt(client);
const landlordId = receipt.accountId.toString();
const landlordKeyDer = landlordKey.toStringDer();

console.log(`✅ Landlord account created: ${landlordId}`);
console.log(`   https://hashscan.io/testnet/account/${landlordId}`);

const updated = envText
  .replace(/^HEDERA_LANDLORD_ID=.*$/m, `HEDERA_LANDLORD_ID=${landlordId}`)
  .replace(/^HEDERA_LANDLORD_KEY=.*$/m, `HEDERA_LANDLORD_KEY=${landlordKeyDer}`);
writeFileSync(envPath, updated);
console.log(`   Wrote HEDERA_LANDLORD_ID / HEDERA_LANDLORD_KEY to .env`);

client.close();
