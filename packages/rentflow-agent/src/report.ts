import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { ledgerFor, deadLettersFor, type LedgerRow } from "./db.js";

export interface ReportContext {
  leaseId: string;
  dailyRate: string;
  asset: string;
  balance: string;
  runwayDays: number;
  daysPaid: number;
  termDays: number;
  simulatedWeek: number;
}

/**
 * Claude-powered weekly tenant report (optional differentiator). Summarizes the
 * payment ledger in plain language and flags anomalies — e.g. a landlord price
 * change mid-month. Gated behind ANTHROPIC_API_KEY; the core flow runs without it.
 */
export async function generateWeeklyReport(ctx: ReportContext): Promise<string> {
  const ledger = ledgerFor(ctx.leaseId);
  const deadLetters = deadLettersFor(ctx.leaseId);

  if (!config.anthropicApiKey) {
    return fallbackReport(ctx, ledger);
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const ledgerLines = ledger
    .map((r) => `${r.date}: paid ${r.amount} ${r.asset} (tx ${r.tx_id})`)
    .join("\n");

  const prompt = `You are RentFlow, an autonomous rent-paying agent reporting to your tenant.
Write a short (max ~150 words), plain-language weekly report. Be concrete and calm.

Lease: ${ctx.leaseId}
Agreed daily rate: ${ctx.dailyRate} ${ctx.asset}
Days paid so far: ${ctx.daysPaid} of ${ctx.termDays}
Current wallet balance: ${ctx.balance} ${ctx.asset}
Runway: ${ctx.runwayDays} days of rent remaining
Failed days (dead-letter): ${deadLetters.length ? deadLetters.map((d) => d.date).join(", ") : "none"}

Payment ledger:
${ledgerLines || "(no payments yet)"}

In your report: state total paid this period, current runway, and call out ANY anomaly
(a quoted price different from the agreed daily rate, gaps in daily coverage, or failed days).
If the tenant should top up soon, say so directly.`;

  try {
    const msg = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return text || fallbackReport(ctx, ledger);
  } catch (err) {
    return `${fallbackReport(ctx, ledger)}\n(Claude report unavailable: ${(err as Error).message})`;
  }
}

/** Deterministic report used when no API key is set or the API call fails. */
function fallbackReport(ctx: ReportContext, ledger: LedgerRow[]): string {
  const total = ledger.reduce((sum, r) => sum + Number(r.amount), 0);
  const anomalies = ledger
    .filter((r) => Number(r.amount) !== Number(ctx.dailyRate))
    .map((r) => `price on ${r.date} was ${r.amount}, not ${ctx.dailyRate}`);
  return [
    `Weekly report — ${ctx.leaseId} (week ${ctx.simulatedWeek})`,
    `Paid ${ledger.length} day(s), total ${total} ${ctx.asset}.`,
    `Balance ${ctx.balance} ${ctx.asset} — runway ${ctx.runwayDays} days.`,
    anomalies.length ? `Anomalies: ${anomalies.join("; ")}.` : `No anomalies detected.`,
    ctx.runwayDays < config.lowBalanceThresholdDays ? `Action: top up soon.` : ``,
  ]
    .filter(Boolean)
    .join(" ");
}
