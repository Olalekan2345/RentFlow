# RentFlow — demo video script (~4:15, under the 5-min limit)

**Format:** screen recording with voiceover. Two columns below: **SAY** (narration,
read naturally) and **DO** (what's on screen). Record the **local** stack for a
smooth, snappy settlement stream (~1 payment / 6–7s), and show the **deployed
URL + GitHub** at the start so judges see it's real and live.

**Before you hit record:**
- Reset for a clean start: stop the stack, `rm -rf packages/*/data`, then run landlord + agent + dashboard (agent primed, waiting for the button).
- Open tabs: (1) dashboard `http://localhost:3000`, (2) a blank tab for HashScan, (3) the GitHub repo, (4) the live Render dashboard.
- Wake the Render services once beforehand so they're warm if you show them.

---

### 0:00–0:25 — The problem (hook)
**SAY:** "In Nigeria, you don't pay rent monthly — landlords demand a *full year
upfront*. For most people that's the single biggest barrier to housing. RentFlow
fixes that: an autonomous agent that pays rent **one day at a time**, settling
on Hedera, with no human in the loop."
**DO:** Start on the dashboard at day 0 (empty feed). Nice and clean.

### 0:25–0:55 — What it is
**SAY:** "A tenant funds an agent wallet once. From then on the agent pays the
landlord for a single day of occupancy at a time, using the **x402 standard** —
HTTP 402, Payment Required — and settling each day on **Hedera testnet**. Hedera's
sub-cent, sub-second fees are what make paying rent *daily* actually viable."
**DO:** Point cursor at the wallet balance and the lease card (1 HBAR/day × 30 days).

### 0:55–2:15 — Live settlement (the core)
**SAY:** "Let me start a month. Watch — each row is a real transaction on Hedera
testnet, appearing every few seconds."
**DO:** Click **"▶ Simulate month."** Let payments stream into the feed for ~30–40s.
Let a handful accumulate.
**SAY (over the stream):** "For every day, the agent asks the landlord for the
day's rent, gets back a 402 with the price and a one-time payment ID, pays it
on-chain with that ID in the transaction memo, and only then gets a signed
receipt. The landlord never trusts the agent — it verifies each payment against
the Hedera **Mirror Node** before issuing the receipt."
**DO:** Point at the runway gauge ticking down and the "days paid" counter rising.

### 2:15–3:00 — Prove it's real (on-chain)
**SAY:** "These aren't mock rows. Let me open one on HashScan."
**DO:** Click a **HashScan** link in the feed. On the HashScan page, point to:
the **1 HBAR transfer** from the agent account to the landlord, the **SUCCESS**
status, and the **memo** (`RentFlow|lease-lagos-001|...`).
**SAY:** "One HBAR, agent to landlord, with the payment ID right there in the
memo — that's what the landlord verified against consensus."

### 3:00–3:45 — The agent is actually intelligent
**SAY:** "This is a real agent, not a script. It makes decisions — watch the log."
**DO:** Scroll the **Agent decision log**. Point to a `TERMS_REJECTED` /
"REFUSED: overcharge" line if present, and the `WEEKLY_REPORT` line.
**SAY:** "It validates every quote against the lease and **refuses to overpay** if
the landlord tries to charge more than the agreed rate. It tracks its runway and
alerts you to top up before it runs dry. And once a week it uses **Claude** to
write you a plain-language report — total paid, runway, and any anomalies."
**DO:** Briefly show the Claude weekly-report card.

### 3:45–4:15 — Close
**SAY:** "So: a fully autonomous rent agent, paying daily micropayments over x402,
settling real transactions on Hedera testnet, with signed receipts as a
verifiable rent history. It's open-source and deployed live."
**DO:** Cut to the **deployed Render dashboard** URL, then the **GitHub repo**.
**SAY:** "That's RentFlow — replacing a year of rent upfront with one day at a
time. Thanks for watching."

---

## Delivery tips
- Keep it moving; don't wait for all 30 days — 6–8 settled rows tell the story.
- If a HashScan page is slow, have one **pre-loaded** in a tab and cut to it.
- Speak to the **tech and the on-chain payments** — that's what the bounty judges.
- Total spoken words ≈ 430–470, which lands around 4 minutes at a natural pace.
- Record at 1080p; hide bookmarks/other tabs; increase browser zoom to ~110% so
  text is legible on playback.
