import { PrivateKey } from "@hashgraph/sdk";

/**
 * Parse a Hedera private key from any of the formats the portal / SDK emit:
 *   - ECDSA hex, EVM-style:  0x25e96b...        (64 hex chars, 0x-prefixed)
 *   - raw 32-byte hex:       25e96b... / ed25519 raw
 *   - DER-encoded:           302e0201...        (ED25519 or ECDSA)
 */
export function parsePrivateKey(raw: string): PrivateKey {
  const s = raw.trim();
  const hex = s.startsWith("0x") ? s.slice(2) : s;

  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    // A 0x prefix is the portal's EVM-style ECDSA key.
    if (s.startsWith("0x")) return PrivateKey.fromStringECDSA(hex);
    // Bare 32-byte hex could be either — prefer ED25519, fall back to ECDSA.
    try {
      return PrivateKey.fromStringED25519(hex);
    } catch {
      return PrivateKey.fromStringECDSA(hex);
    }
  }
  // Anything longer is DER; fromStringDer auto-detects the curve.
  return PrivateKey.fromStringDer(s);
}
