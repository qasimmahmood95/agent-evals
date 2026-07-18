import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.js";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** The one hash used everywhere: sha256 of the canonical serialization. */
export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
