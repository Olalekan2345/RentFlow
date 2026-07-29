import { toMirrorTxId } from "@rentflow/shared";
import { config } from "./config.js";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll the Mirror Node until a transaction appears and reaches consensus.
 * Mirror nodes lag a few seconds behind consensus, so we back off and retry
 * before ever asking the landlord to verify.
 */
export async function waitForMirror(
  sdkTxId: string,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 10;
  const baseDelayMs = opts.baseDelayMs ?? 700;
  const url = `${config.mirrorNodeUrl}/api/v1/transactions/${toMirrorTxId(sdkTxId)}`;

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { transactions?: { result?: string }[] };
        const tx = body.transactions?.[0];
        if (tx && tx.result === "SUCCESS") return true;
      }
    } catch {
      /* network blip — retry with backoff */
    }
    // Exponential backoff with a small cap: 1s, 2s, 4s, ... max 8s.
    await sleep(Math.min(baseDelayMs * 2 ** i, 8000));
  }
  return false;
}
