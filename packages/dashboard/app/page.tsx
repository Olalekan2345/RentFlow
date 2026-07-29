"use client";

import { useEffect, useState, useCallback } from "react";
import {
  AGENT_URL,
  getJSON,
  type AgentStatus,
  type Payment,
  type AgentEvent,
} from "./lib";

const STATE_PILL: Record<string, string> = {
  RUNNING: "live",
  IDLE: "",
  GRACE: "grace",
  ALERT: "alert",
  COMPLETE: "complete",
};

export default function Dashboard() {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [starting, setStarting] = useState(false);

  const poll = useCallback(async () => {
    const [s, l, e] = await Promise.all([
      getJSON<AgentStatus>(`${AGENT_URL}/status`),
      getJSON<{ payments: Payment[] }>(`${AGENT_URL}/ledger`),
      getJSON<{ events: AgentEvent[] }>(`${AGENT_URL}/events`),
    ]);
    if (s) setStatus(s);
    if (l) setPayments(l.payments);
    if (e) setEvents(e.events);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [poll]);

  const simulate = async () => {
    setStarting(true);
    await fetch(`${AGENT_URL}/simulate`, { method: "POST" }).catch(() => {});
    setTimeout(() => setStarting(false), 1500);
    poll();
  };

  const stop = async () => {
    await fetch(`${AGENT_URL}/stop`, { method: "POST" }).catch(() => {});
    poll();
  };

  const online = status !== null;
  const runwayPct = status
    ? Math.max(4, Math.min(100, (status.runwayDays / Math.max(status.termDays, 1)) * 100))
    : 0;
  const paidPct = status ? (status.daysPaid / Math.max(status.termDays, 1)) * 100 : 0;
  const report = [...events].reverse().find((e) => e.type === "weekly_report");
  const pillClass = status ? STATE_PILL[status.state] ?? "" : "";

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <div className="logo">🏠</div>
          <div>
            <h1>RentFlow</h1>
            <p>Autonomous daily rent settlement · x402 · Hedera testnet</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className={`pill ${online ? "live" : "alert"}`}>
            {online ? "agent online" : "agent offline"}
          </span>
          {status && (
            <span className={`pill ${pillClass}`}>{status.state}</span>
          )}
        </div>
      </div>

      {status?.state === "ALERT" && status.lastAlert && (
        <div className="alert-banner">⚠️ <span>{status.lastAlert}</span></div>
      )}
      {status?.state === "GRACE" && (
        <div className="grace-banner">
          🟠 Balance can’t cover today’s rent — agent is holding in <b>GRACE</b> instead of crashing. Top up{" "}
          {status.operatorId}.
        </div>
      )}

      <div className="grid">
        {/* Wallet + runway */}
        <div className="card">
          <h2>Agent Wallet</h2>
          <div className="balance">
            {status ? Number(status.balance).toFixed(status.asset === "HBAR" ? 4 : 2) : "—"}
            <small>{status?.asset ?? ""}</small>
          </div>
          <div className="gauge">
            <span style={{ width: `${runwayPct}%` }} />
          </div>
          <div className="runway-label">
            <span>Runway</span>
            <span className="runway-days">
              {status ? `${status.runwayDays} days of rent` : "—"}
            </span>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="kv"><span className="k">Operator</span><span className="v">{status?.operatorId ?? "—"}</span></div>
            <div className="kv"><span className="k">Simulated day</span><span className="v">{status?.simulatedDay ?? 0}</span></div>
          </div>
        </div>

        {/* Lease card */}
        <div className="card">
          <h2>Lease</h2>
          <div className="balance" style={{ fontSize: 30 }}>
            {status ? `${status.daysPaid}/${status.termDays}` : "—"}
            <small>days paid</small>
          </div>
          <div className="gauge"><span style={{ width: `${paidPct}%` }} /></div>
          <div style={{ marginTop: 16 }}>
            <div className="kv"><span className="k">Lease</span><span className="v">{status?.leaseId ?? "—"}</span></div>
            <div className="kv"><span className="k">Daily rate</span><span className="v">{status ? `${status.dailyRate} ${status.asset}` : "—"}</span></div>
            <div className="kv"><span className="k">Next due</span><span className="v">{status?.nextDueDate ?? "—"}</span></div>
          </div>
        </div>

        {/* Controls */}
        <div className="card">
          <h2>Control</h2>
          <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
            Kick the agent into accelerated time — a full month of daily rent settles on-chain in minutes.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button className="btn" onClick={simulate} disabled={starting || status?.state === "RUNNING"}>
              {status?.state === "RUNNING" ? "Running…" : starting ? "Starting…" : status && status.daysPaid > 0 && status.state !== "COMPLETE" ? "▶ Resume" : "▶ Simulate month"}
            </button>
            <button className="btn btn-stop" onClick={stop} disabled={status?.state !== "RUNNING"}>
              ■ Stop
            </button>
          </div>
          <div style={{ marginTop: 18 }}>
            <div className="kv"><span className="k">Total settled</span><span className="v">{payments.length} days</span></div>
            <div className="kv"><span className="k">Status</span><span className="v">{status?.state ?? "—"}</span></div>
          </div>
        </div>
      </div>

      {report && (
        <>
          <div className="section-title">🧠 Claude weekly report</div>
          <div className="card report-card">
            <p>{report.message}</p>
          </div>
        </>
      )}

      {/* Payment feed — the money shot */}
      <div className="section-title">
        On-chain settlements <span className="count-chip">{payments.length}</span>
      </div>
      <div className="feed">
        {payments.length === 0 && (
          <div className="feed-empty">No settlements yet — press “Simulate month”.</div>
        )}
        {[...payments].reverse().map((p) => (
          <div className="feed-row" key={p.txId}>
            <span className="feed-date">{p.date}</span>
            <span className="feed-amount">{p.amount} {p.asset}</span>
            <a className="feed-link" href={p.hashscanUrl} target="_blank" rel="noreferrer">
              HashScan ↗
            </a>
          </div>
        ))}
      </div>

      {/* Event log */}
      <div className="section-title">Agent decision log</div>
      <div className="log">
        {events.length === 0 && <div className="log-line">waiting for events…</div>}
        {[...events].reverse().slice(0, 120).map((e, i) => (
          <div className="log-line" key={`${e.ts}-${i}`}>
            <span className={`tag ${e.type}`}>{e.type}</span>
            {" "}
            <b>{new Date(e.ts).toLocaleTimeString()}</b> {e.message}
          </div>
        ))}
      </div>

      <div className="footnote">
        RentFlow settles rent daily so tenants never front a year of cash. Every row above is a real Hedera testnet transaction.
      </div>
    </div>
  );
}
