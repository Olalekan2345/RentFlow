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

## Option A — Docker Compose (recommended, always-on)

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
