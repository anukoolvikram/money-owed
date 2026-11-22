import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DB } from "../db/client";

// Persistent per-account sign-in throttle (works across serverless instances).
// After FREE_FAILURES failures, each further failure locks sign-in for that
// normalised email for an exponentially growing delay, capped at MAX_LOCK_SECONDS.
// This is a temporary throttle, never a permanent lockout. A success resets it.
export const FREE_FAILURES = 5;
export const BASE_LOCK_SECONDS = 30;
export const MAX_LOCK_SECONDS = 15 * 60;
/** Failures older than this are forgotten. */
export const FAILURE_MEMORY_SECONDS = 24 * 60 * 60;

export function normaliseEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

export function throttleKey(email: string, secret: string): string {
  // Keyed hash so the table never stores raw email addresses.
  return createHash("sha256").update(secret).update("\0login\0").update(normaliseEmail(email)).digest("hex");
}

export function lockSecondsFor(failures: number): number {
  if (failures < FREE_FAILURES) return 0;
  const exp = failures - FREE_FAILURES;
  return Math.min(MAX_LOCK_SECONDS, BASE_LOCK_SECONDS * 2 ** Math.min(exp, 20));
}

/** Returns remaining lock seconds (0 if sign-in may be attempted). */
export async function checkLoginThrottle(db: DB, key: string): Promise<number> {
  const res = await db.execute<{ remaining: string | null }>(sql`
    SELECT CEIL(EXTRACT(EPOCH FROM (locked_until - now())))::text AS remaining
    FROM login_throttle WHERE key_hash = ${key} AND locked_until > now()`);
  const r = res.rows[0]?.remaining;
  return r ? Math.max(1, Number(r)) : 0;
}

export async function recordLoginFailure(db: DB, key: string): Promise<void> {
  // Single atomic upsert so concurrent failures across instances all count.
  await db.execute(sql`
    INSERT INTO login_throttle (key_hash, failures, last_failure_at, locked_until)
    VALUES (${key}, 1, now(), NULL)
    ON CONFLICT (key_hash) DO UPDATE SET
      failures = CASE
        WHEN login_throttle.last_failure_at < now() - make_interval(secs => ${FAILURE_MEMORY_SECONDS}) THEN 1
        ELSE login_throttle.failures + 1 END,
      last_failure_at = now()`);
  await db.execute(sql`
    UPDATE login_throttle SET locked_until = CASE
      WHEN failures >= ${FREE_FAILURES}
      THEN now() + make_interval(secs => LEAST(${MAX_LOCK_SECONDS}, ${BASE_LOCK_SECONDS} * power(2, LEAST(failures - ${FREE_FAILURES}, 20))))
      ELSE NULL END
    WHERE key_hash = ${key}`);
}

export async function resetLoginThrottle(db: DB, key: string): Promise<void> {
  await db.execute(sql`DELETE FROM login_throttle WHERE key_hash = ${key}`);
}
