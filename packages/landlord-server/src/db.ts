import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { openDb } from "./sqlite.js";

const here = dirname(fileURLToPath(import.meta.url));

// Tests set RENTFLOW_DB=":memory:" for an isolated, throwaway database.
const dbPath = process.env.RENTFLOW_DB?.trim();
let resolvedPath: string;
if (dbPath === ":memory:") {
  resolvedPath = ":memory:";
} else {
  const dataDir = resolve(here, "../data");
  mkdirSync(dataDir, { recursive: true });
  resolvedPath = dbPath || resolve(dataDir, "landlord.db");
}

export const db = openDb(resolvedPath);
if (resolvedPath !== ":memory:") db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS leases (
    lease_id        TEXT PRIMARY KEY,
    landlord_account TEXT NOT NULL,
    asset           TEXT NOT NULL,
    token_id        TEXT,
    daily_rate      TEXT NOT NULL,
    term_days       INTEGER NOT NULL,
    grace_days      INTEGER NOT NULL,
    start_date      TEXT NOT NULL
  );

  -- Payment terms we've advertised; a paymentId is single-use (anti double-spend).
  CREATE TABLE IF NOT EXISTS payment_ids (
    payment_id  TEXT PRIMARY KEY,
    lease_id    TEXT NOT NULL,
    date        TEXT NOT NULL,
    amount      TEXT NOT NULL,
    asset       TEXT NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );

  -- A redeemed tx can never be reused; ties on-chain tx to a receipt.
  CREATE TABLE IF NOT EXISTS receipts (
    tx_id        TEXT PRIMARY KEY,
    payment_id   TEXT NOT NULL,
    lease_id     TEXT NOT NULL,
    date         TEXT NOT NULL,
    asset        TEXT NOT NULL,
    amount       TEXT NOT NULL,
    pay_to       TEXT NOT NULL,
    payer        TEXT NOT NULL,
    hashscan_url TEXT NOT NULL,
    issued_at    INTEGER NOT NULL,
    signature    TEXT NOT NULL,
    signer_pubkey TEXT NOT NULL
  );
`);

export interface LeaseRow {
  lease_id: string;
  landlord_account: string;
  asset: string;
  token_id: string | null;
  daily_rate: string;
  term_days: number;
  grace_days: number;
  start_date: string;
}

export interface ReceiptRow {
  tx_id: string;
  payment_id: string;
  lease_id: string;
  date: string;
  asset: string;
  amount: string;
  pay_to: string;
  payer: string;
  hashscan_url: string;
  issued_at: number;
  signature: string;
  signer_pubkey: string;
}

export interface PaymentIdRow {
  payment_id: string;
  lease_id: string;
  date: string;
  amount: string;
  asset: string;
  expires_at: number;
  created_at: number;
}
