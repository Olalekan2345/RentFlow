# Deploying RentFlow (live public demo)

RentFlow is three pieces:

| Service | Port | Public? | Needs |
|---|---|---|---|
| `landlord-server` | 4021 | reachable by the agent | `HEDERA_LANDLORD_ID/KEY` |
| `rentflow-agent` | 4022 | **yes** (the browser polls it) | `HEDERA_OPERATOR_ID/KEY`, landlord URL |
| `dashboard` (Next.js) | 3000 | **yes** | `NEXT_PUBLIC_AGENT_URL` (agent's public URL) |

Only the **agent** and **dashboard** must be public. The landlord only needs to be
reachable by the agent (server-to-server). The agent already sends permissive
CORS so the dashboard can poll it cross-origin.

> These are **testnet** keys. Set them as host environment variables / secrets —
> never commit them. `.env` is gitignored.

---

## Easiest: all three on Render (no CLI, no card)

Render deploys the whole stack from [render.yaml](render.yaml) through the web UI.

1. Push this repo to GitHub (done).
2. [render.com](https://render.com) → **New → Blueprint** → connect the repo. Render
   reads `render.yaml` and creates `rentflow-landlord`, `rentflow-agent`, and
   `rentflow-dashboard`.
3. Fill the secret env vars (marked `sync: false`):
   - **landlord:** `HEDERA_LANDLORD_ID`, `HEDERA_LANDLORD_KEY`
   - **agent:** `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY`
4. After the first deploy, copy the **agent's** URL
   (`https://rentflow-agent.onrender.com`), set it as `NEXT_PUBLIC_AGENT_URL` on
   the **dashboard** service, and click **Manual Deploy → Clear build cache &
   deploy** (the value is baked into the client bundle at build time).
5. Open the dashboard URL.

⚠️ **Free-tier behavior:** services sleep after ~15 min idle and cold-start
(~30–60s) on the next visit. The agent is built to survive this — it waits for
the landlord to wake, then resumes settling. Great as a bonus demo link; for a
genuinely always-on agent, upgrade the **agent** service to the $7/mo Starter
plan (no sleep). The agent's `RENTFLOW_AUTOSTART=true` (set in `render.yaml`)
means it starts settling automatically each time it wakes.

---

## Alternative: Vercel (dashboard) + Fly.io (agent + landlord)

Vercel is serverless, so it can host the **dashboard** but **not** the agent (a
long-running loop) or the landlord (SQLite on disk). Put those on Fly.io.

### Step 1 — agent + landlord on Fly.io
Install [flyctl](https://fly.io/docs/flyctl/install/), then `fly auth login`.

```bash
# Landlord first (app names are global — pick unique ones if these are taken).
fly apps create rentflow-landlord
fly deploy -c fly.landlord.toml
fly secrets set -a rentflow-landlord \
  HEDERA_LANDLORD_ID=0.0.9828659 HEDERA_LANDLORD_KEY=302e0201...

# Note the landlord URL (https://rentflow-landlord.fly.dev). Put it in
# fly.agent.toml -> NEXT_PUBLIC_LANDLORD_URL if you changed the app name.
fly apps create rentflow-agent
fly deploy -c fly.agent.toml
fly secrets set -a rentflow-agent \
  HEDERA_OPERATOR_ID=0.0.9821653 HEDERA_OPERATOR_KEY=0x25e96b...
```

The agent auto-starts and settles rent live at `https://rentflow-agent.fly.dev`.
(SQLite state is ephemeral across redeploys — the agent simply re-settles; attach
a Fly volume only if you want it to persist.)

### Step 2 — dashboard on Vercel
1. vercel.com → Add New Project → import the repo.
2. **Root Directory = `packages/dashboard`** (the dashboard has no dependency on
   the other packages, so it builds standalone).
3. Env var `NEXT_PUBLIC_AGENT_URL = https://rentflow-agent.fly.dev`.
4. Deploy. Your public dashboard now polls the live agent.

> `NEXT_PUBLIC_*` is baked in at build time — if you change the agent URL, redeploy.

---

## Option A — Docker Compose (all-in-one, any VPS)

Best for a VPS (or your own machine) where the agent should run 24/7.

```bash
# 1. Put your testnet keys in .env at the repo root (see .env.example)
# 2. On a VPS, tell the dashboard how the browser reaches the agent:
PUBLIC_AGENT_URL=http://YOUR_SERVER_IP:4022 docker compose up --build
# Locally, just:
docker compose up --build
```

Then open `http://YOUR_SERVER_IP:3000` (or `http://localhost:3000`). The agent
auto-starts and settles rent continuously.

To put it behind HTTPS + a domain, front it with Caddy or Nginx (reverse-proxy
`:3000` and `:4022`), then set `PUBLIC_AGENT_URL` to the agent's HTTPS URL.

---

## Option B — Render Blueprint (fastest cloud)

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It reads [render.yaml](render.yaml)
   and creates all three services.
3. Fill the secret env vars (marked `sync: false`): `HEDERA_LANDLORD_ID/KEY` on
   the landlord, `HEDERA_OPERATOR_ID/KEY` on the agent.
4. After the first deploy, copy the **agent's** public URL
   (`https://rentflow-agent.onrender.com`), set it as `NEXT_PUBLIC_AGENT_URL` on
   the dashboard service, and **redeploy the dashboard** (the value is baked into
   the client bundle at build time).

⚠️ **Free-tier caveat:** Render free web services sleep after ~15 min idle, which
pauses the autonomous agent. Fine for an on-demand demo (visiting wakes it), but
for a genuinely always-on agent use Option A or a paid instance.

---

## Option C — split hosting

- **Dashboard → Vercel.** Import the repo, set root to `packages/dashboard`
  (or build from root), and set `NEXT_PUBLIC_AGENT_URL` to your agent's public URL.
- **Agent + landlord → Railway / Fly.io.** Use the per-service Dockerfiles
  ([packages/*/Dockerfile](packages)) with build context = repo root. Railway
  doesn't sleep; Fly.io keeps a small always-on allowance.

---

## Environment variables reference

| Var | Service | Notes |
|---|---|---|
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` | agent | the funded wallet; ECDSA-hex or ED25519 both work |
| `HEDERA_LANDLORD_ID` / `HEDERA_LANDLORD_KEY` | landlord | receives rent + signs receipts |
| `NEXT_PUBLIC_LANDLORD_URL` | agent | where the agent reaches the landlord |
| `NEXT_PUBLIC_AGENT_URL` | dashboard | agent's public URL (build-time) |
| `RENTFLOW_AUTOSTART` | agent | `true` to run the loop on boot (default in Docker) |
| `TIME_ACCELERATION_SECONDS` | agent | seconds per simulated rent-day |
| `PORT` | all | injected by most cloud hosts; preferred over the per-service port |
