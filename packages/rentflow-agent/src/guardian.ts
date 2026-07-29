import { config } from "./config.js";

/** Days of rent the current balance can cover. */
export function runwayDays(balance: string, dailyRate: string): number {
  const rate = Number(dailyRate);
  if (rate <= 0) return Infinity;
  return Math.floor(Number(balance) / rate);
}

/** True when balance cannot cover even a single day's rent. */
export function isBelowRent(balance: string, dailyRate: string): boolean {
  return Number(balance) < Number(dailyRate);
}

/** True when runway has fallen below the configured low-balance threshold. */
export function isLowRunway(balance: string, dailyRate: string): boolean {
  return runwayDays(balance, dailyRate) < config.lowBalanceThresholdDays;
}

/** Fire an optional webhook alert; never throws. */
export async function fireWebhook(message: string, data: Record<string, unknown>): Promise<void> {
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "rentflow-agent", message, ...data }),
    });
  } catch {
    /* alerting must never crash the agent */
  }
}
