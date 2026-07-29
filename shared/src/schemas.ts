import { z } from "zod";

/**
 * x402 payload schemas for RentFlow.
 *
 * These mirror the standard x402 (HTTP 402 Payment Required) handshake used by
 * the reference repo `matevszm/x402-hedera-example`, adapted for a per-day
 * occupancy "product". The landlord advertises payment terms; the agent pays
 * on-chain and re-requests with proof; the landlord returns a signed receipt.
 */

/** A Hedera account id, e.g. "0.0.12345". */
export const HederaAccountId = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, "expected a Hedera account id like 0.0.12345");

/** A Hedera transaction id, e.g. "0.0.12345@1699999999.123456789". */
export const HederaTxId = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+@\d+\.\d+$/,
    "expected a Hedera tx id like 0.0.123@1699999999.000000000",
  );

/** Asset the rent is denominated in. */
export const AssetKind = z.enum(["HBAR", "USDC"]);
export type AssetKind = z.infer<typeof AssetKind>;

/**
 * The body returned with a 402 Payment Required response. This is the core
 * x402 "payment terms" advertisement — everything the agent needs to pay.
 */
export const PaymentRequirementsSchema = z.object({
  /** Protocol marker so clients can branch on version. */
  x402Version: z.literal(1),
  /** Human-readable resource being sold. */
  resource: z.string(),
  /** The lease this day belongs to. */
  leaseId: z.string(),
  /** The occupancy date (YYYY-MM-DD) being purchased. */
  date: z.string(),
  /** Settlement network. */
  network: z.literal("hedera-testnet"),
  /** What asset to pay in. */
  asset: AssetKind,
  /** For USDC settlement, the HTS token id; null for HBAR. */
  tokenId: HederaAccountId.nullable(),
  /**
   * Amount owed, as a decimal string in display units (HBAR or USDC).
   * String to avoid float drift; the agent converts to tinybar/base units.
   */
  amount: z.string(),
  /** Where to send payment. */
  payTo: HederaAccountId,
  /** Unique nonce the agent must echo in the tx memo. Single-use. */
  paymentId: z.string().uuid(),
  /** Unix ms after which these terms are void. */
  expiresAt: z.number().int().positive(),
  /** The exact memo string the agent must place on the transfer. */
  memo: z.string(),
});
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

/**
 * A signed occupancy receipt returned on a verified paid request. The signature
 * lets anyone verify the landlord attested to this payment without trusting us.
 */
export const OccupancyReceiptSchema = z.object({
  leaseId: z.string(),
  date: z.string(),
  asset: AssetKind,
  amount: z.string(),
  payTo: HederaAccountId,
  payer: HederaAccountId,
  txId: HederaTxId,
  paymentId: z.string().uuid(),
  hashscanUrl: z.string().url(),
  /** Unix ms the receipt was issued. */
  issuedAt: z.number().int().positive(),
  /** Ed25519 signature (hex) over the canonical receipt payload. */
  signature: z.string(),
  /** Public key (hex/DER) the signature verifies against. */
  signerPublicKey: z.string(),
});
export type OccupancyReceipt = z.infer<typeof OccupancyReceiptSchema>;

/** Lease terms returned by GET /lease/:leaseId. */
export const LeaseTermsSchema = z.object({
  leaseId: z.string(),
  landlordAccount: HederaAccountId,
  asset: AssetKind,
  tokenId: HederaAccountId.nullable(),
  dailyRate: z.string(),
  termDays: z.number().int().positive(),
  gracePeriodDays: z.number().int().nonnegative(),
  startDate: z.string(),
  nextDueDate: z.string(),
  daysPaid: z.number().int().nonnegative(),
});
export type LeaseTerms = z.infer<typeof LeaseTermsSchema>;

/** The canonical fields that get signed into a receipt (order matters). */
export function canonicalReceiptPayload(
  r: Pick<
    OccupancyReceipt,
    | "leaseId"
    | "date"
    | "asset"
    | "amount"
    | "payTo"
    | "payer"
    | "txId"
    | "paymentId"
    | "issuedAt"
  >,
): string {
  return [
    r.leaseId,
    r.date,
    r.asset,
    r.amount,
    r.payTo,
    r.payer,
    r.txId,
    r.paymentId,
    String(r.issuedAt),
  ].join("|");
}

/** Agent event-log line (JSONL). The dashboard tails these. */
export const AgentEventSchema = z.object({
  ts: z.number().int().positive(),
  type: z.enum([
    "startup",
    "lease_fetched",
    "day_due",
    "terms_received",
    "terms_rejected",
    "payment_sent",
    "receipt_received",
    "retry",
    "alert",
    "grace",
    "dead_letter",
    "weekly_report",
    "info",
  ]),
  leaseId: z.string().optional(),
  date: z.string().optional(),
  message: z.string(),
  data: z.record(z.unknown()).optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** Snapshot the agent exposes at GET /status for the dashboard. */
export const AgentStatusSchema = z.object({
  operatorId: HederaAccountId,
  asset: AssetKind,
  tokenId: HederaAccountId.nullable(),
  balance: z.string(),
  dailyRate: z.string(),
  runwayDays: z.number(),
  leaseId: z.string(),
  daysPaid: z.number().int().nonnegative(),
  termDays: z.number().int().positive(),
  nextDueDate: z.string(),
  state: z.enum(["IDLE", "RUNNING", "GRACE", "ALERT", "COMPLETE"]),
  simulatedDay: z.number().int().nonnegative(),
  lastAlert: z.string().nullable(),
  updatedAt: z.number().int().positive(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
