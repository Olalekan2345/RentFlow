/**
 * Chain-agnostic-ish helpers shared by the landlord server and the agent.
 * No @hashgraph/sdk import here so this module stays light and testable; the
 * SDK is used directly in the agent where transactions are actually built.
 */

/** Tinybar per HBAR. */
export const TINYBAR_PER_HBAR = 100_000_000n;

/**
 * Build a HashScan testnet explorer link for a transaction id.
 * HashScan resolves the dash-separated form: 0.0.x@sss.nnn -> 0.0.x-sss-nnn.
 */
export function hashscanTxUrl(sdkTxId: string): string {
  return `https://hashscan.io/testnet/transaction/${toMirrorTxId(sdkTxId)}`;
}

/**
 * Mirror Node uses a different tx-id encoding than the SDK: it replaces `@`
 * with `-` and the fractional `.` in the valid-start with `-`.
 * SDK: `0.0.1234@1699999999.123456789`
 * Mirror: `0.0.1234-1699999999-123456789`
 */
export function toMirrorTxId(sdkTxId: string): string {
  const [acct, stamp] = sdkTxId.split("@");
  if (!stamp) return sdkTxId;
  return `${acct}-${stamp.replace(".", "-")}`;
}

/** Inverse of toMirrorTxId. */
export function fromMirrorTxId(mirrorTxId: string): string {
  const parts = mirrorTxId.split("-");
  if (parts.length < 3) return mirrorTxId;
  const nanos = parts.pop()!;
  const seconds = parts.pop()!;
  const acct = parts.join("-");
  return `${acct}@${seconds}.${nanos}`;
}

/** Convert a decimal HBAR string to a bigint tinybar amount. */
export function hbarToTinybar(hbar: string): bigint {
  const [whole, frac = ""] = hbar.trim().split(".");
  const fracPadded = (frac + "00000000").slice(0, 8);
  return BigInt(whole || "0") * TINYBAR_PER_HBAR + BigInt(fracPadded || "0");
}

/** Convert tinybar back to a trimmed decimal HBAR string. */
export function tinybarToHbar(tinybar: bigint): string {
  const whole = tinybar / TINYBAR_PER_HBAR;
  const frac = tinybar % TINYBAR_PER_HBAR;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/**
 * Convert a decimal token amount (display units) to base units given decimals.
 * Hedera testnet USDC uses 6 decimals.
 */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const [whole, frac = ""] = amount.trim().split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const scale = 10n ** BigInt(decimals);
  return BigInt(whole || "0") * scale + BigInt(fracPadded || "0");
}

/** Convert base units back to a trimmed decimal display string. */
export function fromBaseUnits(base: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = base / scale;
  const frac = base % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export const USDC_DECIMALS = 6;
