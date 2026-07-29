#!/usr/bin/env node
/**
 * One-command demo. Builds shared types, seeds the demo lease, then boots the
 * landlord server, the autonomous agent (accelerated time), and the dashboard.
 *
 *   npm run demo
 *
 * Requires a filled-in .env (copy from .env.example) with funded testnet keys.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

if (!existsSync(resolve(root, ".env"))) {
  console.error("\n❌ No .env found. Copy .env.example to .env and fill in your Hedera testnet keys.\n");
  process.exit(1);
}

function run(args, label) {
  console.log(`\n▶ ${label}...`);
  const r = spawnSync(npm, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`\n❌ ${label} failed.\n`);
    process.exit(r.status ?? 1);
  }
}

// 1. Build shared types (packages resolve @rentflow/shared -> dist).
run(["run", "build:shared"], "Building shared types");

// 2. Seed the demo lease (idempotent).
run(["run", "seed", "-w", "packages/landlord-server"], "Seeding demo lease");

// 3. Boot all three services together.
console.log("\n🚀 Booting landlord + agent + dashboard (Ctrl-C to stop)\n");
const child = spawn(
  npm,
  [
    "exec",
    "--",
    "concurrently",
    "-k",
    "-n",
    "landlord,agent,dashboard",
    "-c",
    "magenta,cyan,yellow",
    "npm:dev:landlord",
    "npm:dev:agent",
    "npm:dev:dashboard",
  ],
  { cwd: root, stdio: "inherit", shell: true },
);

// Give the landlord a head start so the agent's startup() finds it.
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
