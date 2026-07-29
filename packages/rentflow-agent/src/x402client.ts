import {
  PaymentRequirementsSchema,
  OccupancyReceiptSchema,
  LeaseTermsSchema,
  type PaymentRequirements,
  type OccupancyReceipt,
  type LeaseTerms,
} from "@rentflow/shared";
import { config } from "./config.js";

const base = config.landlordUrl.replace(/\/$/, "");

export async function fetchLease(): Promise<LeaseTerms> {
  const res = await fetch(`${base}/lease/${config.leaseId}`);
  if (!res.ok) throw new Error(`lease fetch failed: HTTP ${res.status}`);
  return LeaseTermsSchema.parse(await res.json());
}

/** Step 1 of the x402 handshake: ask for a day, receive 402 + terms. */
export async function requestTerms(): Promise<
  | { kind: "terms"; terms: PaymentRequirements }
  | { kind: "complete" }
  | { kind: "error"; status: number; body: unknown }
> {
  const res = await fetch(`${base}/occupancy/${config.leaseId}/day`);
  if (res.status === 402) {
    return { kind: "terms", terms: PaymentRequirementsSchema.parse(await res.json()) };
  }
  if (res.status === 409) {
    return { kind: "complete" }; // lease fully paid
  }
  return { kind: "error", status: res.status, body: await res.json().catch(() => null) };
}

export interface Refusal {
  ok: false;
  reason: string;
}
export interface Accepted {
  ok: true;
}

/**
 * The agent's judgment step. Validate advertised terms against the signed
 * lease before spending a cent. This is where autonomy shows: the agent
 * refuses to overpay, pay the wrong account, or pay in the wrong asset.
 */
export function validateTerms(
  terms: PaymentRequirements,
  lease: LeaseTerms,
): Refusal | Accepted {
  if (terms.leaseId !== lease.leaseId) {
    return { ok: false, reason: `lease mismatch: terms ${terms.leaseId} vs lease ${lease.leaseId}` };
  }
  if (terms.network !== "hedera-testnet") {
    return { ok: false, reason: `unexpected network ${terms.network}` };
  }
  if (terms.asset !== lease.asset) {
    return { ok: false, reason: `asset mismatch: terms ${terms.asset} vs lease ${lease.asset}` };
  }
  if (terms.payTo !== lease.landlordAccount) {
    return {
      ok: false,
      reason: `payee mismatch: terms want ${terms.payTo}, lease landlord is ${lease.landlordAccount}`,
    };
  }
  // Overcharge guard: never pay more than the agreed daily rate.
  if (Number(terms.amount) > Number(lease.dailyRate)) {
    return {
      ok: false,
      reason: `overcharge refused: quoted ${terms.amount} > agreed daily rate ${lease.dailyRate}`,
    };
  }
  if (terms.expiresAt < Date.now()) {
    return { ok: false, reason: "payment terms already expired" };
  }
  return { ok: true };
}

function paymentHeader(txId: string, paymentId: string): string {
  return Buffer.from(JSON.stringify({ txId, paymentId }), "utf8").toString("base64url");
}

/**
 * Step 3: re-request the day with on-chain proof. Handles mirror lag: the
 * landlord answers 425 while its own mirror lookup is still catching up, so we
 * retry with backoff before giving up.
 */
export async function redeem(
  txId: string,
  paymentId: string,
  opts: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<
  | { kind: "receipt"; receipt: OccupancyReceipt }
  | { kind: "error"; status: number; body: unknown }
> {
  const attempts = opts.attempts ?? 6;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let last: { status: number; body: unknown } = { status: 0, body: null };
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${base}/occupancy/${config.leaseId}/day`, {
      headers: { "X-Payment": paymentHeader(txId, paymentId) },
    });
    if (res.status === 200) {
      return { kind: "receipt", receipt: OccupancyReceiptSchema.parse(await res.json()) };
    }
    const body = await res.json().catch(() => null);
    last = { status: res.status, body };
    // 425 Too Early → landlord's mirror lookup hasn't caught up. Back off, retry.
    if (res.status === 425) {
      await sleep(Math.min(baseDelayMs * 2 ** i, 8000));
      continue;
    }
    // Any other non-200 is a hard failure — don't hammer it.
    break;
  }
  return { kind: "error", status: last.status, body: last.body };
}
