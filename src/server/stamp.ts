import "server-only";
import { createHash } from "node:crypto";

/** Short fingerprint of what a page shows; changes whenever the shown data changes. */
export function dataStamp(...parts: unknown[]): string {
  return createHash("sha1").update(JSON.stringify(parts)).digest("base64url").slice(0, 16);
}
