import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load the monorepo-root .env regardless of where the process is launched from.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../../.env") });

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("0.0.xxxxxx") || v.startsWith("302e0201...")) {
    throw new Error(
      `Missing env ${name}. Copy .env.example to .env and fill in your Hedera testnet values.`,
    );
  }
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

const usdcTokenId = opt("USDC_TOKEN_ID").trim();
const useUsdc = usdcTokenId.length > 0;

export const config = {
  landlordId: req("HEDERA_LANDLORD_ID"),
  landlordKey: req("HEDERA_LANDLORD_KEY"),
  network: opt("HEDERA_NETWORK", "testnet"),
  mirrorNodeUrl: opt("MIRROR_NODE_URL", "https://testnet.mirrornode.hedera.com"),
  asset: (useUsdc ? "USDC" : "HBAR") as "HBAR" | "USDC",
  usdcTokenId: useUsdc ? usdcTokenId : null,
  leaseId: opt("LEASE_ID", "lease-lagos-001"),
  dailyRate: useUsdc ? opt("DAILY_RATE_USDC", "5") : opt("DAILY_RATE_HBAR", "1"),
  termDays: Number(opt("LEASE_TERM_DAYS", "30")),
  gracePeriodDays: Number(opt("GRACE_PERIOD_DAYS", "3")),
  port: Number(opt("LANDLORD_PORT", "4021")),
  /** How long 402 terms remain valid, in ms. */
  termsTtlMs: 5 * 60 * 1000,
} as const;

export function isConfigured(): boolean {
  try {
    req("HEDERA_LANDLORD_ID");
    req("HEDERA_LANDLORD_KEY");
    return true;
  } catch {
    return false;
  }
}
