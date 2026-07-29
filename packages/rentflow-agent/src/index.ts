import { config } from "./config.js";
import { createAgentServer } from "./server.js";
import { startup, runLoop } from "./agent.js";

async function main() {
  const app = createAgentServer();
  app.listen(config.port, () => {
    console.log(`\n🤖  RentFlow agent`);
    console.log(`    status api     http://localhost:${config.port}/status`);
    console.log(`    operator       ${config.operatorId}`);
    console.log(`    asset          ${config.asset}${config.usdcTokenId ? ` (${config.usdcTokenId})` : ""}`);
    console.log(`    acceleration   1 rent-day = ${config.timeAccelerationSeconds}s`);
    console.log(`    landlord       ${config.landlordUrl}\n`);
  });

  const autostart = process.env.RENTFLOW_AUTOSTART !== "false";

  if (autostart) {
    // Best-effort initial startup, but never block on it: the loop is
    // self-healing — each tick re-fetches the lease, so a slow/cold-starting
    // landlord (common on free cloud tiers) is tolerated and recovered from.
    startup().catch((err) =>
      console.warn(`   initial startup deferred (loop will retry): ${(err as Error).message}`),
    );
    void runLoop();
  } else {
    // Waiting for the dashboard "Simulate month" button — retry startup so the
    // dashboard shows lease + balance even before the first payment.
    const maxStartupAttempts = 45;
    for (let attempt = 1; attempt <= maxStartupAttempts; attempt++) {
      try {
        await startup();
        break;
      } catch (err) {
        if (attempt === maxStartupAttempts) {
          console.error(`\n❌ startup failed: ${(err as Error).message}`);
          console.error(`   Is the landlord reachable at ${config.landlordUrl}? Are your keys funded?\n`);
          return;
        }
        if (attempt === 1) console.log(`   Landlord not ready yet — retrying...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    console.log("   Waiting for POST /simulate (RENTFLOW_AUTOSTART=false).\n");
  }
}

void main();
