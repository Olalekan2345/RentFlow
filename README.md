# 🏠 RentFlow — autonomous rent settlement on Hedera

> **Daily rent, paid by an agent, one day at a time — over the x402 standard, settled on Hedera testnet.**
> Hedera x402 Bounty entry · deadline July 31, 2026

---

## The problem

In Nigeria, landlords demand **12 months of rent upfront**. A tenant who earns
monthly must somehow produce a year of cash before moving in — the single
biggest barrier to housing in the country. There is no "pay as you live" option
because collecting rent daily is operationally impossible for a human landlord:
too many tiny transfers, too much reconciliation, too much trust.

**RentFlow removes the human from the loop.** A tenant funds an agent wallet
once. From then on, an autonomous agent pays the landlord **one day of
occupancy at a time**, settling each day on Hedera testnet at a fixed sub-cent
fee, using the **x402 (HTTP 402 Payment Required)** standard. No subscription,
no invoice, no upfront year. The landlord gets a verifiable daily stream; the
tenant gets a wallet they can top up like airtime.

---

## What's in the box

A TypeScript monorepo with three services + shared types:

```
rentflow/
├── shared/                     # zod schemas for every x402 payload + receipt, Hedera helpers
├── packages/
│   ├── landlord-server/        # x402 paywall: 402 terms → Mirror-Node verify → signed receipts
│   ├── rentflow-agent/         # the autonomous tenant agent (wallet, loop, guardian, retries)
│   └── dashboard/              # Next.js 14 dark-fintech live dashboard
└── scripts/demo.mjs            # one-command boot
```

### The x402 handshake (the core of the entry)

```
 AGENT                                   LANDLORD SERVER                 HEDERA
   │  GET /occupancy/:lease/day             │                              │
   │───────────────────────────────────────▶                              │
   │           402 Payment Required         │                              │
   │   { amount, payTo, paymentId, memo,   │                              │
   │     asset, network:hedera-testnet }   │                              │
   │◀───────────────────────────────────────                              │
   │                                        │                              │
   │  validate terms (reject overcharge!)   │                              │
   │                                        │                              │
   │  TransferTransaction(memo=paymentId)   │                              │
   │──────────────────────────────────────────────────────────────────────▶
   │                                        │            txId              │
   │◀──────────────────────────────────────────────────────────────────────
   │  poll Mirror Node until tx has consensus                              │
   │                                        │                              │
   │  GET /occupancy/:lease/day             │  verify via Mirror Node:     │
   │  X-Payment: {txId, paymentId}          │  ✓ SUCCESS ✓ recipient       │
   │───────────────────────────────────────▶  ✓ amount ✓ memo has nonce   │
   │                                        │  ✓ not already redeemed      │
   │        200 + signed receipt            │                              │
   │◀───────────────────────────────────────                              │
```

The landlord **never trusts the client** — every payment is verified against
the **Hedera Mirror Node REST API** (`testnet.mirrornode.hedera.com`). Each
`paymentId` nonce is single-use and each transaction id can be redeemed exactly
once (persisted in SQLite), so replay and double-spend are impossible. Receipts
are **Ed25519-signed by the landlord key**, so the tenant's rent history is
independently verifiable off-server.

---

## Why this is a strong x402 entry

- **Real on-chain testnet transactions.** Every settled day is a genuine
  `TransferTransaction` on Hedera testnet with a HashScan link (see the demo
  table below). Sub-cent, sub-second finality is exactly what per-day
  micropayments need — this problem is *only* viable on a chain like Hedera.
- **Standard x402 semantics.** The 402 body and `X-Payment` handshake follow
  the pattern from [`matevszm/x402-hedera-example`](https://github.com/matevszm/x402-hedera-example);
  judges will recognize the shapes. Payloads are zod-schema'd in `shared/`.
- **A real agent, not a script.** Budgeting (runway), scheduling (accelerated
  cron), retries with backoff, mirror-lag handling, idempotency, a dead-letter
  log, a GRACE state instead of crashing, and **judgment** — it refuses to pay
  an overcharge and logs the refusal.
- **Claude differentiator.** Once per simulated week the agent asks Claude
  (`claude-sonnet-4-6`) to write the tenant a plain-language report and flag
  anomalies (e.g. "the landlord's quoted price changed on day 12"). Optional —
  the core flow runs without an API key.

---

## Quick start

### 1. Prerequisites
- **Node 22+ or 24** (RentFlow uses Node's built-in `node:sqlite` — **no native
  build step, no C++ toolchain**).
- A free **Hedera testnet** account from [portal.hedera.com](https://portal.hedera.com)
  with faucet HBAR — **two** accounts actually: one for the landlord, one for
  the tenant agent.

### 2. Configure
```bash
cp .env.example .env
# fill in HEDERA_LANDLORD_ID/KEY and HEDERA_OPERATOR_ID/KEY (the agent)
npm install
```

### 3. Run the whole thing
```bash
npm run demo
```
This builds shared types, seeds the demo lease, and boots all three services.
Then open **http://localhost:3000** and hit **“Simulate month.”** With the
default `TIME_ACCELERATION_SECONDS=10`, a 30-day month settles on-chain in ~5
minutes — each day a real testnet transfer, each row a clickable HashScan link.

### Run pieces individually
```bash
npm run dev:landlord     # x402 server on :4021
npm run dev:agent        # agent + status api on :4022
npm run dev:dashboard    # dashboard on :3000
npm test                 # unit tests (see below)
```

---

## Verify it by hand (curl)

```bash
# 1. Ask for a day → 402 with payment terms
curl -i http://localhost:4021/occupancy/lease-lagos-001/day

# 2. Pay it yourself on testnet with the memo from the 402 body, then redeem:
curl -i http://localhost:4021/occupancy/lease-lagos-001/day \
  -H "X-Payment: $(echo -n '{"txId":"0.0.x@..","paymentId":".."}' | base64)"

# 3. See the signed receipt trail (the tenant's rent history)
curl http://localhost:4021/receipts/lease-lagos-001
```

---

## HBAR vs USDC

By default RentFlow settles in **HBAR** (tinybar pricing). To settle in an HTS
token instead, set `USDC_TOKEN_ID` in `.env` to a Hedera testnet token id — the
agent auto-runs a `TokenAssociateTransaction` before its first transfer and the
landlord verifies `token_transfers` on the Mirror Node. No token id is
hardcoded anywhere.

---

## Tests

Critical paths are covered with Vitest (Mirror Node calls are mocked, no network needed):

| Test | What it proves |
|---|---|
| `shared/src/hedera.test.ts` | tinybar/base-unit math + Mirror/HashScan tx-id encoding |
| `landlord-server` → `402 payment terms` | the 402 body matches the x402 schema |
| `landlord-server` → `verified payment` | Mirror-verified pay → independently-verifiable signed receipt |
| `landlord-server` → `double-spend` | a redeemed tx cannot be reused |
| `landlord-server` → `underpayment` | an under-amount transfer is refused |
| `landlord-server` → `mirror lag` | returns 425 Too Early while the mirror catches up |
| `rentflow-agent` → `validateTerms` | **agent refuses an overcharge**, wrong payee, wrong asset |
| `rentflow-agent` → `guardian` | runway math + low-balance / below-rent detection |

```bash
npm test
```

---

## Demo HashScan links

Captured from a live Hedera **testnet** run on 2026-07-29. Agent wallet
`0.0.9821653` pays landlord `0.0.9828659` one day of rent at a time; each row is
a real `TransferTransaction` verified on the Mirror Node and turned into a
landlord-signed receipt.

- **Landlord account** (auto-created + funded from the agent): https://hashscan.io/testnet/account/0.0.9828659
- **Agent account**: https://hashscan.io/testnet/account/0.0.9821653

| Sim. day | Rent date | Amount | Transaction |
|---|---|---|---|
| 1 | 2026-07-29 | 1 HBAR | https://hashscan.io/testnet/transaction/0.0.9821653-1785330425-108458035 |
| 2 | 2026-07-30 | 1 HBAR | https://hashscan.io/testnet/transaction/0.0.9821653-1785330441-584146140 |
| 3 | 2026-07-31 | 1 HBAR | https://hashscan.io/testnet/transaction/0.0.9821653-1785330458-402689674 |
| 4 | 2026-08-01 | 1 HBAR | https://hashscan.io/testnet/transaction/0.0.9821653-1785330474-708286767 |
| 5 | 2026-08-02 | 1 HBAR | https://hashscan.io/testnet/transaction/0.0.9821653-1785330490-506128499 |
| 6 | 2026-08-03 | 1 HBAR | https://hashscan.io/testnet/transaction/0.0.9821653-1785330508-955655301 |

> `npm run demo` prints a fresh HashScan link to the agent console for every day
> it settles; the dashboard renders them as a clickable feed in real time.

---

## Architecture notes

- **Persistence:** SQLite via Node's built-in `node:sqlite` — zero-config for
  anyone cloning the repo. The landlord stores advertised `paymentId`s +
  redeemed receipts; the agent stores its own ledger + a dead-letter table.
- **Idempotency:** the agent keys its ledger by `(leaseId, date)` and never
  double-pays; the landlord enforces single-use `paymentId`s and single-redeem
  `txId`s.
- **Resilience:** exponential backoff on Mirror-Node lag, transient chain
  errors retried up to 4×, permanently failed days written to a dead-letter log,
  and a `GRACE` state (hold, don't crash) when the balance can't cover a day.
- **Strict TypeScript** throughout; every wire payload validated with zod.

## License

MIT — see [LICENSE](LICENSE).
