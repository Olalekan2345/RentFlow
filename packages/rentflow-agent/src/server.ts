import express from "express";
import { state } from "./state.js";
import { recentEvents } from "./eventlog.js";
import { ledgerFor, deadLettersFor } from "./db.js";
import { config } from "./config.js";
import { runLoop, isRunning, stop, resetRun } from "./agent.js";

export function createAgentServer() {
  const app = express();
  app.use(express.json());

  // Permissive CORS so the Next.js dashboard can poll from :3000.
  app.use((_req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Headers", "*");
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true, running: isRunning() }));

  app.get("/status", (_req, res) => res.json(state));

  app.get("/events", (req, res) => {
    const since = Number(req.query.since ?? 0);
    res.json({ events: recentEvents(Number.isFinite(since) ? since : 0) });
  });

  app.get("/ledger", (_req, res) => {
    const rows = ledgerFor(config.leaseId).map((r) => ({
      date: r.date,
      amount: r.amount,
      asset: r.asset,
      txId: r.tx_id,
      hashscanUrl: r.hashscan_url,
      paidAt: r.paid_at,
    }));
    res.json({ leaseId: config.leaseId, count: rows.length, payments: rows });
  });

  app.get("/dead-letter", (_req, res) => {
    res.json({ leaseId: config.leaseId, entries: deadLettersFor(config.leaseId) });
  });

  // The dashboard "Simulate month" button hits this. Every click starts a fresh
  // run from day 1: reset both sides, then kick off the accelerated loop.
  app.post("/simulate", async (_req, res) => {
    if (isRunning()) return res.json({ started: false, message: "already running" });
    await resetRun();
    void runLoop();
    res.json({ started: true, message: "fresh run started from day 1" });
  });

  // The dashboard "Stop" button hits this to pause the loop after the current day.
  app.post("/stop", (_req, res) => {
    if (!isRunning()) return res.json({ stopped: false, message: "not running" });
    stop();
    res.json({ stopped: true, message: "stopping after the current day" });
  });

  return app;
}
