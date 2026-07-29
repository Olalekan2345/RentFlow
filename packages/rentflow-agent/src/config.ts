import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

// Some hosts (Render service-linking) provide "host:port" without a scheme.
function normalizeUrl(u: string): string {
  const s = u.trim().replace(/\/$/, "");
  return /^https?:\/\//.test(s) ? s : `http://${s}`;
}

export const config = {
  operatorId: req("HEDERA_OPERATOR_ID"),
  operatorKey: req("HEDERA_OPERATOR_KEY"),
  network: opt("HEDERA_NETWORK", "testnet"),
  mirrorNodeUrl: opt("MIRROR_NODE_URL", "https://testnet.mirrornode.hedera.com"),
  asset: (useUsdc ? "USDC" : "HBAR") as "HBAR" | "USDC",
  usdcTokenId: useUsdc ? usdcTokenId : null,
  leaseId: opt("LEASE_ID", "lease-lagos-001"),
  landlordUrl: normalizeUrl(opt("NEXT_PUBLIC_LANDLORD_URL", "http://localhost:4021")),
  // Cloud hosts (Render/Railway/Fly) inject $PORT; fall back to AGENT_PORT locally.
  port: Number(opt("PORT", "") || opt("AGENT_PORT", "4022")),
  timeAccelerationSeconds: Number(opt("TIME_ACCELERATION_SECONDS", "10")),
  lowBalanceThresholdDays: Number(opt("LOW_BALANCE_THRESHOLD_DAYS", "5")),
  anthropicApiKey: opt("ANTHROPIC_API_KEY").trim(),
  anthropicModel: opt("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
  alertWebhookUrl: opt("ALERT_WEBHOOK_URL").trim(),
} as const;
