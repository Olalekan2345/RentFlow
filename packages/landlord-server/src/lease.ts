import { db, type LeaseRow, type ReceiptRow } from "./db.js";
import { config } from "./config.js";
import type { LeaseTerms, AssetKind } from "@rentflow/shared";

/** Add N days to a YYYY-MM-DD date (UTC). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Create the demo lease if it doesn't exist yet. Idempotent. */
export function ensureLease(startDate = todayUtc()): LeaseRow {
  const existing = getLease(config.leaseId);
  if (existing) return existing;
  db.prepare(
    `INSERT INTO leases
      (lease_id, landlord_account, asset, token_id, daily_rate, term_days, grace_days, start_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    config.leaseId,
    config.landlordId,
    config.asset,
    config.usdcTokenId,
    config.dailyRate,
    config.termDays,
    config.gracePeriodDays,
    startDate,
  );
  return getLease(config.leaseId)!;
}

/** Wipe all receipts/payment-ids and re-seed the lease starting today. */
export function resetLease(): LeaseRow {
  db.exec("DELETE FROM receipts; DELETE FROM payment_ids; DELETE FROM leases;");
  return ensureLease();
}

export function getLease(leaseId: string): LeaseRow | undefined {
  return db.prepare(`SELECT * FROM leases WHERE lease_id = ?`).get(leaseId) as
    | LeaseRow
    | undefined;
}

export function daysPaid(leaseId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM receipts WHERE lease_id = ?`)
    .get(leaseId) as { n: number };
  return row.n;
}

/** The date of the next unpaid occupancy day for a lease. */
export function nextDueDate(lease: LeaseRow): string {
  return addDays(lease.start_date, daysPaid(lease.lease_id));
}

export function leaseToTerms(lease: LeaseRow): LeaseTerms {
  return {
    leaseId: lease.lease_id,
    landlordAccount: lease.landlord_account,
    asset: lease.asset as AssetKind,
    tokenId: lease.token_id,
    dailyRate: lease.daily_rate,
    termDays: lease.term_days,
    gracePeriodDays: lease.grace_days,
    startDate: lease.start_date,
    nextDueDate: nextDueDate(lease),
    daysPaid: daysPaid(lease.lease_id),
  };
}

export function receiptsFor(leaseId: string): ReceiptRow[] {
  return db
    .prepare(`SELECT * FROM receipts WHERE lease_id = ? ORDER BY issued_at ASC`)
    .all(leaseId) as ReceiptRow[];
}

export function receiptForDate(leaseId: string, date: string): ReceiptRow | undefined {
  return db
    .prepare(`SELECT * FROM receipts WHERE lease_id = ? AND date = ?`)
    .get(leaseId, date) as ReceiptRow | undefined;
}
