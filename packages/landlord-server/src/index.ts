import { createApp } from "./server.js";
import { config } from "./config.js";
import { ensureLease } from "./lease.js";

const lease = ensureLease();
const app = createApp();

app.listen(config.port, () => {
  console.log(`\n🏠  RentFlow landlord-server`);
  console.log(`    listening      http://localhost:${config.port}`);
  console.log(`    landlord acct  ${config.landlordId}`);
  console.log(`    asset          ${config.asset}${config.usdcTokenId ? ` (${config.usdcTokenId})` : ""}`);
  console.log(`    lease          ${lease.lease_id}  @ ${lease.daily_rate}/day  x${lease.term_days} days`);
  console.log(`    x402 endpoint  GET /occupancy/${lease.lease_id}/day\n`);
});
