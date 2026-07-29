import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { PrivateKey } from "@hashgraph/sdk";

// Configure env BEFORE importing anything that reads config at module load.
const landlordKey = PrivateKey.generateED25519();
process.env.RENTFLOW_DB = ":memory:";
process.env.HEDERA_LANDLORD_ID = "0.0.1001";
process.env.HEDERA_LANDLORD_KEY = landlordKey.toStringDer();
process.env.HEDERA_OPERATOR_ID = "0.0.2002";
process.env.HEDERA_OPERATOR_KEY = PrivateKey.generateED25519().toStringDer();
process.env.USDC_TOKEN_ID = "";
process.env.LEASE_ID = "lease-test-001";
process.env.DAILY_RATE_HBAR = "1";
process.env.LEASE_TERM_DAYS = "30";

// Dynamic imports so the env above is in place first.
const { createApp, buildMemo } = await import("./server.js");
const { PaymentRequirementsSchema, hbarToTinybar } = await import("@rentflow/shared");
const { verifyReceipt } = await import("./signing.js");
const { db } = await import("./db.js");
const request = (await import("supertest")).default;

const LANDLORD = "0.0.1001";
const TENANT = "0.0.2002";
const LEASE = "lease-test-001";

/** Fake a Mirror Node response for a successful HBAR transfer. */
function mirrorOk(opts: { payTo: string; amount: string; memo: string; payer: string }) {
  const tinybar = Number(hbarToTinybar(opts.amount));
  return {
    ok: true,
    status: 200,
    json: async () => ({
      transactions: [
        {
          transaction_id: "0.0.2002-1699999999-000000000",
          result: "SUCCESS",
          memo_base64: Buffer.from(opts.memo, "utf8").toString("base64"),
          consensus_timestamp: "1699999999.000000000",
          transfers: [
            { account: opts.payer, amount: -tinybar },
            { account: opts.payTo, amount: tinybar },
          ],
        },
      ],
    }),
  };
}

function mirror404() {
  return { ok: false, status: 404, json: async () => ({}) };
}

/** Drive a full 402 → pay → receipt cycle. Returns the paymentId + memo used. */
async function getTerms(app: ReturnType<typeof createApp>) {
  const res = await request(app).get(`/occupancy/${LEASE}/day`);
  return res;
}

function paymentHeader(txId: string, paymentId: string) {
  return Buffer.from(JSON.stringify({ txId, paymentId }), "utf8").toString("base64url");
}

let app: ReturnType<typeof createApp>;

beforeEach(() => {
  // Reset mutable tables between tests for isolation.
  db.exec("DELETE FROM receipts; DELETE FROM payment_ids;");
});

describe("402 payment terms", () => {
  it("returns a spec-shaped 402 body on an unpaid request", async () => {
    app = createApp({ fetchImpl: async () => mirror404() });
    const res = await getTerms(app);
    expect(res.status).toBe(402);
    const parsed = PaymentRequirementsSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);
    expect(res.body.payTo).toBe(LANDLORD);
    expect(res.body.network).toBe("hedera-testnet");
    expect(res.body.amount).toBe("1");
    expect(res.body.memo).toBe(buildMemo(LEASE, res.body.date, res.body.paymentId));
  });
});

describe("mirror-node verified payment → signed receipt", () => {
  it("issues an independently-verifiable signed receipt", async () => {
    const terms = (await getTerms(createApp({ fetchImpl: async () => mirror404() }))).body;
    app = createApp({
      fetchImpl: async () =>
        mirrorOk({ payTo: LANDLORD, amount: "1", memo: terms.memo, payer: TENANT }),
    });
    const txId = "0.0.2002@1699999999.000000000";
    const res = await request(app)
      .get(`/occupancy/${LEASE}/day`)
      .set("X-Payment", paymentHeader(txId, terms.paymentId));

    expect(res.status).toBe(200);
    expect(res.body.txId).toBe(txId);
    expect(res.body.payer).toBe(TENANT);
    expect(res.body.hashscanUrl).toContain("hashscan.io/testnet");
    expect(verifyReceipt(res.body)).toBe(true);
  });
});

describe("double-spend rejection", () => {
  it("rejects reusing a transaction that was already redeemed", async () => {
    const terms = (await getTerms(createApp({ fetchImpl: async () => mirror404() }))).body;
    app = createApp({
      fetchImpl: async () =>
        mirrorOk({ payTo: LANDLORD, amount: "1", memo: terms.memo, payer: TENANT }),
    });
    const txId = "0.0.2002@1699999999.111111111";
    const first = await request(app)
      .get(`/occupancy/${LEASE}/day`)
      .set("X-Payment", paymentHeader(txId, terms.paymentId));
    expect(first.status).toBe(200);

    // New terms, same txId → must be refused.
    const terms2 = (await getTerms(createApp({ fetchImpl: async () => mirror404() }))).body;
    const second = await request(app)
      .get(`/occupancy/${LEASE}/day`)
      .set("X-Payment", paymentHeader(txId, terms2.paymentId));
    expect(second.status).toBe(409);
  });
});

describe("underpayment rejection", () => {
  it("refuses a transfer that credits less than the daily rate", async () => {
    const terms = (await getTerms(createApp({ fetchImpl: async () => mirror404() }))).body;
    app = createApp({
      fetchImpl: async () =>
        mirrorOk({ payTo: LANDLORD, amount: "0.5", memo: terms.memo, payer: TENANT }),
    });
    const res = await request(app)
      .get(`/occupancy/${LEASE}/day`)
      .set("X-Payment", paymentHeader("0.0.2002@1699999999.222222222", terms.paymentId));
    expect(res.status).toBe(402);
    expect(res.body.error).toMatch(/underpaid/);
  });
});

describe("mirror lag", () => {
  it("returns 425 Too Early when the tx is not yet on the mirror node", async () => {
    const terms = (await getTerms(createApp({ fetchImpl: async () => mirror404() }))).body;
    app = createApp({ fetchImpl: async () => mirror404() });
    const res = await request(app)
      .get(`/occupancy/${LEASE}/day`)
      .set("X-Payment", paymentHeader("0.0.2002@1699999999.333333333", terms.paymentId));
    expect(res.status).toBe(425);
    expect(res.body.retryable).toBe(true);
  });
});
