import { config } from "./config.js";
import { logEvent } from "./eventlog.js";
import { state, patchState } from "./state.js";
import {
  settlementBalance,
  ensureTokenAssociation,
  payRent,
} from "./wallet.js";
import { fetchLease, requestTerms, validateTerms, redeem } from "./x402client.js";
import { waitForMirror, sleep } from "./mirror.js";
import { isDayPaid, recordPayment, deadLetter, resetLedger } from "./db.js";
import { runwayDays, isBelowRent, isLowRunway, fireWebhook } from "./guardian.js";
import { generateWeeklyReport } from "./report.js";
import { hashscanTxUrl } from "@rentflow/shared";

let running = false;
let stopFlag = false;

/** Refresh balance + runway into the shared state. */
async function refreshBalance(dailyRate: string): Promise<string> {
  const balance = await settlementBalance();
  patchState({ balance, runwayDays: runwayDays(balance, dailyRate) });
  return balance;
}

/**
 * Settle one due day through the full x402 handshake, with resilience:
 * validate terms → pay on-chain → wait for mirror → redeem for a receipt.
 * Retries transient failures; dead-letters permanent ones.
 */
async function settleOneDay(dailyRate: string): Promise<"paid" | "refused" | "complete" | "failed"> {
  const req = await requestTerms();
  if (req.kind === "complete") return "complete";
  if (req.kind === "error") {
    logEvent({ type: "retry", leaseId: config.leaseId, message: `terms request failed (HTTP ${req.status})`, data: { body: req.body } });
    return "failed";
  }

  const terms = req.terms;

  // Idempotency: never double-pay a day we already settled.
  if (isDayPaid(config.leaseId, terms.date)) {
    logEvent({ type: "info", leaseId: config.leaseId, date: terms.date, message: `day ${terms.date} already settled — skipping` });
    return "paid";
  }

  logEvent({
    type: "terms_received",
    leaseId: config.leaseId,
    date: terms.date,
    message: `landlord quoted ${terms.amount} ${terms.asset} for ${terms.date}`,
    data: { paymentId: terms.paymentId, payTo: terms.payTo },
  });

  // Agent judgment: refuse bad terms (overcharge, wrong payee/asset).
  const lease = await fetchLease();
  const verdict = validateTerms(terms, lease);
  if (!verdict.ok) {
    logEvent({ type: "terms_rejected", leaseId: config.leaseId, date: terms.date, message: `REFUSED: ${verdict.reason}` });
    deadLetter(config.leaseId, terms.date, `refused: ${verdict.reason}`);
    return "refused";
  }

  // Execute the on-chain transfer, retrying transient chain errors.
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { txId } = await payRent(terms.payTo, terms.amount, terms.memo);
      logEvent({
        type: "payment_sent",
        leaseId: config.leaseId,
        date: terms.date,
        message: `sent ${terms.amount} ${terms.asset} → ${terms.payTo}  ${hashscanTxUrl(txId)}`,
        data: { txId, hashscanUrl: hashscanTxUrl(txId) },
      });

      // Wait for the mirror node to catch up before redeeming.
      await waitForMirror(txId);

      const redeemed = await redeem(txId, terms.paymentId);
      if (redeemed.kind === "receipt") {
        recordPayment(redeemed.receipt);
        logEvent({
          type: "receipt_received",
          leaseId: config.leaseId,
          date: terms.date,
          message: `receipt for ${terms.date} ✓  ${redeemed.receipt.hashscanUrl}`,
          data: { txId, hashscanUrl: redeemed.receipt.hashscanUrl },
        });
        return "paid";
      }
      // Landlord rejected the proof — log and retry the whole day.
      logEvent({
        type: "retry",
        leaseId: config.leaseId,
        date: terms.date,
        message: `redeem failed (HTTP ${redeemed.status}), attempt ${attempt}/${maxAttempts}`,
        data: { body: redeemed.body },
      });
    } catch (err) {
      logEvent({
        type: "retry",
        leaseId: config.leaseId,
        date: terms.date,
        message: `payment attempt ${attempt}/${maxAttempts} errored: ${(err as Error).message}`,
      });
    }
    await sleep(Math.min(1000 * 2 ** attempt, 8000));
  }

  logEvent({ type: "dead_letter", leaseId: config.leaseId, date: terms.date, message: `day ${terms.date} permanently failed after ${maxAttempts} attempts` });
  deadLetter(config.leaseId, terms.date, "exhausted retries");
  return "failed";
}

/** One simulated day: guardian checks, then settle. */
async function tick(): Promise<boolean> {
  const lease = await fetchLease();
  patchState({
    dailyRate: lease.dailyRate,
    daysPaid: lease.daysPaid,
    termDays: lease.termDays,
    nextDueDate: lease.nextDueDate,
  });

  if (lease.daysPaid >= lease.termDays) {
    patchState({ state: "COMPLETE" });
    logEvent({ type: "info", leaseId: config.leaseId, message: `lease complete — all ${lease.termDays} days settled` });
    return false;
  }

  patchState({ simulatedDay: state.simulatedDay + 1 });
  logEvent({ type: "day_due", leaseId: config.leaseId, date: lease.nextDueDate, message: `simulated day ${state.simulatedDay}: rent due for ${lease.nextDueDate}` });

  const balance = await refreshBalance(lease.dailyRate);

  // Budget guardian.
  if (isLowRunway(balance, lease.dailyRate)) {
    const msg = `low balance: runway ${runwayDays(balance, lease.dailyRate)} days (< ${config.lowBalanceThresholdDays}) — top up ${config.operatorId}`;
    patchState({ state: "ALERT", lastAlert: msg });
    logEvent({ type: "alert", leaseId: config.leaseId, message: msg, data: { balance } });
    await fireWebhook(msg, { balance, operatorId: config.operatorId });
  }

  if (isBelowRent(balance, lease.dailyRate)) {
    patchState({ state: "GRACE" });
    logEvent({ type: "grace", leaseId: config.leaseId, date: lease.nextDueDate, message: `GRACE: balance ${balance} cannot cover ${lease.dailyRate} — holding, not crashing` });
    return true; // stay alive; tenant may top up
  }

  if (state.state !== "ALERT") patchState({ state: "RUNNING" });
  const outcome = await settleOneDay(lease.dailyRate);
  await refreshBalance(lease.dailyRate);

  if (outcome === "complete") {
    patchState({ state: "COMPLETE" });
    return false;
  }

  // Weekly Claude report every 7 simulated days.
  if (state.simulatedDay % 7 === 0) {
    await emitWeeklyReport(lease.dailyRate);
  }
  return true;
}

async function emitWeeklyReport(dailyRate: string): Promise<void> {
  const balance = await settlementBalance();
  const report = await generateWeeklyReport({
    leaseId: config.leaseId,
    dailyRate,
    asset: config.asset,
    balance,
    runwayDays: runwayDays(balance, dailyRate),
    daysPaid: state.daysPaid,
    termDays: state.termDays,
    simulatedWeek: Math.ceil(state.simulatedDay / 7),
  });
  logEvent({ type: "weekly_report", leaseId: config.leaseId, message: report });
}

/** Boot the agent: associate token, fetch lease, report runway. */
export async function startup(): Promise<void> {
  logEvent({ type: "startup", message: `RentFlow agent online — operator ${config.operatorId}, asset ${config.asset}` });
  if (config.usdcTokenId) {
    const associated = await ensureTokenAssociation();
    logEvent({ type: "info", message: associated ? `associated token ${config.usdcTokenId}` : `token ${config.usdcTokenId} already associated` });
  }
  const lease = await fetchLease();
  const balance = await refreshBalance(lease.dailyRate);
  patchState({
    dailyRate: lease.dailyRate,
    daysPaid: lease.daysPaid,
    termDays: lease.termDays,
    nextDueDate: lease.nextDueDate,
    state: "IDLE",
  });
  logEvent({
    type: "lease_fetched",
    leaseId: config.leaseId,
    message: `lease ${lease.leaseId}: ${lease.dailyRate} ${lease.asset}/day × ${lease.termDays} days. Balance ${balance} covers ${runwayDays(balance, lease.dailyRate)} days.`,
  });
}

/**
 * Wipe both sides back to day 0 for a fresh run: reset the landlord's lease +
 * receipts, clear the agent's own ledger, and repopulate state. Called by the
 * dashboard "Simulate month" button so every click starts cleanly from day 1.
 */
export async function resetRun(): Promise<void> {
  try {
    await fetch(`${config.landlordUrl}/reset`, { method: "POST" });
  } catch (err) {
    logEvent({ type: "info", message: `landlord reset failed: ${(err as Error).message}` });
  }
  resetLedger();
  patchState({ simulatedDay: 0, daysPaid: 0, state: "IDLE", lastAlert: null });
  logEvent({ type: "info", message: "reset — starting a fresh lease from day 1" });
  await startup();
}

/** Run the accelerated rent loop until the lease completes or stop() is called. */
export async function runLoop(): Promise<void> {
  if (running) return;
  running = true;
  stopFlag = false;
  patchState({ state: "RUNNING" });
  const intervalMs = Math.max(1, config.timeAccelerationSeconds) * 1000;

  while (!stopFlag) {
    const startedAt = Date.now();
    let keepGoing = true;
    try {
      keepGoing = await tick();
    } catch (err) {
      logEvent({ type: "info", message: `tick error: ${(err as Error).message}` });
    }
    if (!keepGoing) break;
    // Fixed cadence: each day starts intervalMs after the previous one, so the
    // spacing is steady regardless of how long the on-chain settlement took.
    const elapsed = Date.now() - startedAt;
    await sleep(Math.max(0, intervalMs - elapsed));
  }
  running = false;
  // Paused by the user (Stop) — reflect it, unless the lease already completed.
  if (stopFlag && state.state !== "COMPLETE") {
    patchState({ state: "IDLE" });
    logEvent({ type: "info", leaseId: config.leaseId, message: "paused by user — press Simulate to resume" });
  }
}

export function stop(): void {
  stopFlag = true;
}

export function isRunning(): boolean {
  return running;
}
