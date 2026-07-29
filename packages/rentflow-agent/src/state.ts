import type { AgentStatus } from "@rentflow/shared";
import { config } from "./config.js";

/** Live agent status the dashboard polls. Mutated in place by the loop. */
export const state: AgentStatus = {
  operatorId: config.operatorId,
  asset: config.asset,
  tokenId: config.usdcTokenId,
  balance: "0",
  dailyRate: "0",
  runwayDays: 0,
  leaseId: config.leaseId,
  daysPaid: 0,
  termDays: 0,
  nextDueDate: "",
  state: "IDLE",
  simulatedDay: 0,
  lastAlert: null,
  updatedAt: Date.now(),
};

export function patchState(patch: Partial<AgentStatus>): void {
  Object.assign(state, patch, { updatedAt: Date.now() });
}
