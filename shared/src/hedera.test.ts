import { describe, it, expect } from "vitest";
import {
  hbarToTinybar,
  tinybarToHbar,
  toBaseUnits,
  fromBaseUnits,
  toMirrorTxId,
  fromMirrorTxId,
  hashscanTxUrl,
} from "./hedera.js";

describe("hbar/tinybar conversion", () => {
  it("round-trips whole and fractional HBAR", () => {
    expect(hbarToTinybar("1")).toBe(100_000_000n);
    expect(hbarToTinybar("0.5")).toBe(50_000_000n);
    expect(hbarToTinybar("1.23456789")).toBe(123_456_789n);
    expect(tinybarToHbar(100_000_000n)).toBe("1");
    expect(tinybarToHbar(123_456_789n)).toBe("1.23456789");
    expect(tinybarToHbar(50_000_000n)).toBe("0.5");
  });
});

describe("token base-unit conversion (6 decimals)", () => {
  it("round-trips display units", () => {
    expect(toBaseUnits("5", 6)).toBe(5_000_000n);
    expect(toBaseUnits("5.5", 6)).toBe(5_500_000n);
    expect(fromBaseUnits(5_000_000n, 6)).toBe("5");
    expect(fromBaseUnits(5_500_000n, 6)).toBe("5.5");
  });
});

describe("mirror tx id encoding", () => {
  it("converts between SDK and mirror forms", () => {
    const sdk = "0.0.1234@1699999999.123456789";
    const mirror = "0.0.1234-1699999999-123456789";
    expect(toMirrorTxId(sdk)).toBe(mirror);
    expect(fromMirrorTxId(mirror)).toBe(sdk);
  });

  it("builds a hashscan link in mirror form", () => {
    expect(hashscanTxUrl("0.0.1234@1699999999.123456789")).toBe(
      "https://hashscan.io/testnet/transaction/0.0.1234-1699999999-123456789",
    );
  });
});
