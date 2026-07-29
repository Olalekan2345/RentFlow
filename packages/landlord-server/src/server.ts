import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import {
  PaymentRequirementsSchema,
  type PaymentRequirements,
  type OccupancyReceipt,
  hashscanTxUrl,
} from "@rentflow/shared";
import { config } from "./config.js";
import { db, type PaymentIdRow } from "./db.js";
import {
  ensureLease,
  getLease,
  leaseToTerms,
  nextDueDate,
  daysPaid,
  receiptsFor,
  resetLease,
} from "./lease.js";
import { signReceipt, landlordPublicKeyRaw } from "./signing.js";
import {
  verifyPaymentOnMirror,
  type FetchLike,
  type ExpectedPayment,
} from "./mirror.js";

/** The exact memo the agent must stamp onto its transfer. */
export function buildMemo(leaseId: string, date: string, paymentId: string): string {
  return `RentFlow|${leaseId}|${date}|${paymentId}`;
}

/** Extract { txId, paymentId } from an incoming paid request. */
function parsePaymentHeader(req: Request): { txId: string; paymentId: string } | null {
  const header = req.header("X-Payment");
  if (!header) return null;

  // Preferred: X-Payment is a base64url JSON payment payload (x402-idiomatic).
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    if (decoded && typeof decoded.txId === "string" && typeof decoded.paymentId === "string") {
      return { txId: decoded.txId, paymentId: decoded.paymentId };
    }
  } catch {
    // fall through to plain form
  }

  // curl-friendly fallback: X-Payment is the raw txId, paymentId in its own header.
  const paymentId = req.header("X-Payment-Id");
  if (header && paymentId) return { txId: header, paymentId };
  return null;
}

export interface AppOptions {
  /** Injectable fetch for the Mirror Node (tests mock this). */
  fetchImpl?: FetchLike;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.use(express.json());
  ensureLease();

  app.get("/health", (_req, res) => {
    res.json({ ok: true, landlord: config.landlordId, asset: config.asset });
  });

  // Lease terms.
  app.get("/lease/:leaseId", (req, res) => {
    const lease = getLease(req.params.leaseId);
    if (!lease) return res.status(404).json({ error: "lease not found" });
    res.json(leaseToTerms(lease));
  });

  // Full signed-receipt trail — the tenant's on-chain rent history.
  app.get("/receipts/:leaseId", (req, res) => {
    const lease = getLease(req.params.leaseId);
    if (!lease) return res.status(404).json({ error: "lease not found" });
    const rows = receiptsFor(req.params.leaseId).map(rowToReceipt);
    res.json({ leaseId: req.params.leaseId, count: rows.length, receipts: rows });
  });

  app.get("/landlord/pubkey", (_req, res) => {
    res.json({ account: config.landlordId, publicKey: landlordPublicKeyRaw });
  });

  // Clear all lease state and re-seed a fresh lease starting today. Used by the
  // agent when the dashboard "Simulate month" button asks for a fresh run.
  app.post("/reset", (_req, res) => {
    const lease = resetLease();
    res.json({ ok: true, lease: leaseToTerms(lease) });
  });

  // ── The x402 endpoint: one day of verified occupancy. ────────────────────
  app.get("/occupancy/:leaseId/day", async (req, res) => {
    const lease = getLease(req.params.leaseId);
    if (!lease) return res.status(404).json({ error: "lease not found" });

    const paid = daysPaid(lease.lease_id);
    if (paid >= lease.term_days) {
      return res.status(409).json({ error: "lease fully paid", daysPaid: paid });
    }

    const proof = parsePaymentHeader(req);

    // ── No proof → advertise payment terms (402). ──────────────────────────
    if (!proof) {
      const date = nextDueDate(lease);
      const paymentId = randomUUID();
      const expiresAt = Date.now() + config.termsTtlMs;
      const memo = buildMemo(lease.lease_id, date, paymentId);

      db.prepare(
        `INSERT INTO payment_ids (payment_id, lease_id, date, amount, asset, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(paymentId, lease.lease_id, date, lease.daily_rate, lease.asset, expiresAt, Date.now());

      const requirements: PaymentRequirements = {
        x402Version: 1,
        resource: `occupancy/${lease.lease_id}/${date}`,
        leaseId: lease.lease_id,
        date,
        network: "hedera-testnet",
        asset: lease.asset as "HBAR" | "USDC",
        tokenId: lease.token_id,
        amount: lease.daily_rate,
        payTo: lease.landlord_account,
        paymentId,
        expiresAt,
        memo,
      };
      // Validate our own advertisement before sending.
      PaymentRequirementsSchema.parse(requirements);

      res.status(402);
      res.set("X-Accept-Payment", "hedera-testnet");
      return res.json(requirements);
    }

    // ── Proof present → verify on-chain, then issue a signed receipt. ──────
    const term = db
      .prepare(`SELECT * FROM payment_ids WHERE payment_id = ?`)
      .get(proof.paymentId) as PaymentIdRow | undefined;

    if (!term) {
      return res.status(400).json({ error: "unknown paymentId" });
    }
    if (term.expires_at < Date.now()) {
      return res.status(402).json({ error: "payment terms expired, request new terms" });
    }
    if (term.lease_id !== lease.lease_id) {
      return res.status(400).json({ error: "paymentId does not match lease" });
    }

    // Double-spend guard: this tx must never have been redeemed before.
    const already = db
      .prepare(`SELECT tx_id FROM receipts WHERE tx_id = ?`)
      .get(proof.txId) as { tx_id: string } | undefined;
    if (already) {
      return res.status(409).json({ error: "transaction already redeemed", txId: proof.txId });
    }

    const expected: ExpectedPayment = {
      asset: term.asset as "HBAR" | "USDC",
      tokenId: lease.token_id,
      amount: term.amount,
      payTo: lease.landlord_account,
      paymentId: term.payment_id,
    };

    const result = await verifyPaymentOnMirror(proof.txId, expected, opts.fetchImpl);
    if (!result.ok) {
      // Mirror lag → 425 Too Early so the agent polls and retries.
      const status = result.retryable ? 425 : 402;
      return res.status(status).json({ error: result.reason, retryable: result.retryable });
    }

    // Build + sign the receipt.
    const issuedAt = Date.now();
    const hashscanUrl = hashscanTxUrl(proof.txId);
    const signFields = {
      leaseId: lease.lease_id,
      date: term.date,
      asset: term.asset as "HBAR" | "USDC",
      amount: term.amount,
      payTo: lease.landlord_account,
      payer: result.payer,
      txId: proof.txId,
      paymentId: term.payment_id,
      issuedAt,
    };
    const { signature, signerPublicKey } = signReceipt(signFields);

    try {
      db.prepare(
        `INSERT INTO receipts
          (tx_id, payment_id, lease_id, date, asset, amount, pay_to, payer, hashscan_url, issued_at, signature, signer_pubkey)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        proof.txId,
        term.payment_id,
        lease.lease_id,
        term.date,
        term.asset,
        term.amount,
        lease.landlord_account,
        result.payer,
        hashscanUrl,
        issuedAt,
        signature,
        signerPublicKey,
      );
    } catch (err) {
      // UNIQUE violation on tx_id or (implicitly) a concurrent redeem.
      return res.status(409).json({ error: "transaction already redeemed" });
    }

    const receipt: OccupancyReceipt = { ...signFields, hashscanUrl, signature, signerPublicKey };
    return res.status(200).json(receipt);
  });

  return app;
}

function rowToReceipt(row: {
  lease_id: string;
  date: string;
  asset: string;
  amount: string;
  pay_to: string;
  payer: string;
  tx_id: string;
  payment_id: string;
  hashscan_url: string;
  issued_at: number;
  signature: string;
  signer_pubkey: string;
}): OccupancyReceipt {
  return {
    leaseId: row.lease_id,
    date: row.date,
    asset: row.asset as "HBAR" | "USDC",
    amount: row.amount,
    payTo: row.pay_to,
    payer: row.payer,
    txId: row.tx_id,
    paymentId: row.payment_id,
    hashscanUrl: row.hashscan_url,
    issuedAt: row.issued_at,
    signature: row.signature,
    signerPublicKey: row.signer_pubkey,
  };
}
