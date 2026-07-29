import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { OccupancyReceipt } from "@rentflow/shared";
import { openDb } from "./sqlite.js";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.RENTFLOW_AGENT_DB?.trim();
let resolvedPath: string;
if (dbPath === ":memory:") {
  resolvedPath = ":memory:";
} else {
  const dataDir = resolve(here, "../data");
  mkdirSync(dataDir, { recursive: true });
  resolvedPath = dbPath || resolve(dataDir, "agent.db");
}

export const db = openDb(resolvedPath);
if (resolvedPath !== ":memory:") db.pragma("journal_mode = WAL");

db.exec(`
  -- The agent's own copy of every settled day (idempotency + reporting).
  CREATE TABLE IF NOT EXISTS ledger (
    lease_id   TEXT NOT NULL,
    date       TEXT NOT NULL,
    asset      TEXT NOT NULL,
    amount     TEXT NOT NULL,
    tx_id      TEXT NOT NULL,
    payment_id TEXT NOT NULL,
    hashscan_url TEXT NOT NULL,
    receipt_json TEXT NOT NULL,
    paid_at    INTEGER NOT NULL,
    PRIMARY KEY (lease_id, date)
  );

  -- Days that permanently failed after exhausting retries.
  CREATE TABLE IF NOT EXISTS dead_letter (
    lease_id  TEXT NOT NULL,
    date      TEXT NOT NULL,
    reason    TEXT NOT NULL,
    failed_at INTEGER NOT NULL,
    PRIMARY KEY (lease_id, date)
  );
`);

export function isDayPaid(leaseId: string, date: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM ledger WHERE lease_id = ? AND date = ?`)
    .get(leaseId, date);
  return !!row;
}

export function recordPayment(receipt: OccupancyReceipt): void {
  db.prepare(
    `INSERT OR IGNORE INTO ledger
      (lease_id, date, asset, amount, tx_id, payment_id, hashscan_url, receipt_json, paid_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    receipt.leaseId,
    receipt.date,
    receipt.asset,
    receipt.amount,
    receipt.txId,
    receipt.paymentId,
    receipt.hashscanUrl,
    JSON.stringify(receipt),
    Date.now(),
  );
}

export interface LedgerRow {
  lease_id: string;
  date: string;
  asset: string;
  amount: string;
  tx_id: string;
  payment_id: string;
  hashscan_url: string;
  receipt_json: string;
  paid_at: number;
}

export function ledgerFor(leaseId: string): LedgerRow[] {
  return db
    .prepare(`SELECT * FROM ledger WHERE lease_id = ? ORDER BY paid_at ASC`)
    .all(leaseId) as LedgerRow[];
}

export function deadLetter(leaseId: string, date: string, reason: string): void {
  db.prepare(
    `INSERT OR REPLACE INTO dead_letter (lease_id, date, reason, failed_at) VALUES (?, ?, ?, ?)`,
  ).run(leaseId, date, reason, Date.now());
}

/** Wipe the agent's own ledger + dead-letter log for a fresh run. */
export function resetLedger(): void {
  db.exec("DELETE FROM ledger; DELETE FROM dead_letter;");
}

export function deadLettersFor(leaseId: string): { date: string; reason: string }[] {
  return db
    .prepare(`SELECT date, reason FROM dead_letter WHERE lease_id = ? ORDER BY failed_at ASC`)
    .all(leaseId) as { date: string; reason: string }[];
}
