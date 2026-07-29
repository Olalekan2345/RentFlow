import { PublicKey } from "@hashgraph/sdk";
import {
  canonicalReceiptPayload,
  type OccupancyReceipt,
} from "@rentflow/shared";
import { config } from "./config.js";
import { parsePrivateKey } from "./keys.js";

const landlordKey = parsePrivateKey(config.landlordKey);
const landlordPub = landlordKey.publicKey;

/** Sign the canonical receipt payload; returns hex signature + signer pubkey. */
export function signReceipt(
  fields: Pick<
    OccupancyReceipt,
    | "leaseId"
    | "date"
    | "asset"
    | "amount"
    | "payTo"
    | "payer"
    | "txId"
    | "paymentId"
    | "issuedAt"
  >,
): { signature: string; signerPublicKey: string } {
  const message = Buffer.from(canonicalReceiptPayload(fields), "utf8");
  const sig = landlordKey.sign(message);
  return {
    signature: Buffer.from(sig).toString("hex"),
    signerPublicKey: landlordPub.toStringRaw(),
  };
}

/** Independently verify a signed receipt (used by tests and the agent). */
export function verifyReceipt(receipt: OccupancyReceipt): boolean {
  try {
    const pub = PublicKey.fromStringED25519(receipt.signerPublicKey);
    const message = Buffer.from(canonicalReceiptPayload(receipt), "utf8");
    return pub.verify(message, Buffer.from(receipt.signature, "hex"));
  } catch {
    return false;
  }
}

export const landlordPublicKeyRaw = landlordPub.toStringRaw();
