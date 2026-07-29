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

  // The landlord may still be booting (npm run demo starts both together).
  // Retry startup with backoff before giving up.
  let started = false;
  for (let attempt = 1; attempt <= 10 && !started; attempt++) {
    try {
      await startup();
      started = true;
    } catch (err) {
      if (attempt === 10) {
        console.error(`\n❌ startup failed: ${(err as Error).message}`);
        console.error(`   Is the landlord-server running at ${config.landlordUrl}? Are your .env keys funded?\n`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Auto-start the accelerated loop unless told to wait for the dashboard button.
  if (process.env.RENTFLOW_AUTOSTART !== "false") {
    void runLoop();
  } else {
    console.log("   Waiting for POST /simulate (RENTFLOW_AUTOSTART=false).\n");
  }
}

void main();
