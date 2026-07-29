import { ensureLease, leaseToTerms } from "./lease.js";

// Seed the demo lease starting today so the agent has something to pay against.
const lease = ensureLease();
console.log("Seeded lease:");
console.log(JSON.stringify(leaseToTerms(lease), null, 2));
