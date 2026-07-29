import { describe, it, expect } from "vitest";
import { PrivateKey } from "@hashgraph/sdk";

// Config reads env at import time — set sane values before importing.
process.env.RENTFLOW_AGENT_DB = ":memory:";
process.env.HEDERA_OPERATOR_ID = "0.0.2002";
process.env.HEDERA_OPERATOR_KEY = PrivateKey.generateED25519().toStringDer();
process.env.HEDERA_LANDLORD_ID = "0.0.1001";
process.env.LEASE_ID = "lease-test-001";
process.env.LOW_BALANCE_THRESHOLD_DAYS = "5";
process.env.DAILY_RATE_HBAR = "1";

const { validateTerms } = await import("./x402client.js");
const { runwayDays, isBelowRent, isLowRunway } = await import("./guardian.js");
const type = await import("@rentflow/shared");

const lease: import("@rentflow/shared").LeaseTerms = {
  leaseId: "lease-test-001",
  landlordAccount: "0.0.1001",
  asset: "HBAR",
  tokenId: null,
  dailyRate: "1",
  termDays: 30,
  gracePeriodDays: 3,
  startDate: "2026-07-01",
  nextDueDate: "2026-07-05",
  daysPaid: 4,
};

function terms(overrides: Partial<import("@rentflow/shared").PaymentRequirements> = {}) {
  const base: import("@rentflow/shared").PaymentRequirements = {
    x402Version: 1,
    resource: "occupancy/lease-test-001/2026-07-05",
    leaseId: "lease-test-001",
    date: "2026-07-05",
    network: "hedera-testnet",
    asset: "HBAR",
    tokenId: null,
    amount: "1",
    payTo: "0.0.1001",
    paymentId: "00000000-0000-0000-0000-000000000000",
    expiresAt: Date.now() + 60_000,
    memo: "RentFlow|lease-test-001|2026-07-05|nonce",
  };
  return { ...base, ...overrides };
}

describe("agent judgment: validateTerms", () => {
  it("accepts fair terms", () => {
    expect(validateTerms(terms(), lease).ok).toBe(true);
  });

  it("REFUSES an overcharge above the agreed daily rate", () => {
    const v = validateTerms(terms({ amount: "2" }), lease);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/overcharge/);
  });

  it("refuses a wrong payee", () => {
    const v = validateTerms(terms({ payTo: "0.0.9999" }), lease);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/payee/);
  });

  it("refuses a wrong asset", () => {
    const v = validateTerms(terms({ asset: "USDC" }), lease);
    expect(v.ok).toBe(false);
  });

  it("refuses expired terms", () => {
    const v = validateTerms(terms({ expiresAt: Date.now() - 1 }), lease);
    expect(v.ok).toBe(false);
  });

  it("accepts a discount (agent pays less than the cap)", () => {
    expect(validateTerms(terms({ amount: "0.5" }), lease).ok).toBe(true);
  });
});

describe("budget guardian runway math", () => {
  it("computes runway days", () => {
    expect(runwayDays("10", "1")).toBe(10);
    expect(runwayDays("4.5", "1")).toBe(4);
  });
  it("flags below-rent balances", () => {
    expect(isBelowRent("0.5", "1")).toBe(true);
    expect(isBelowRent("1", "1")).toBe(false);
  });
  it("flags low runway under the threshold", () => {
    expect(isLowRunway("4", "1")).toBe(true); // 4 < 5
    expect(isLowRunway("6", "1")).toBe(false);
  });
});
