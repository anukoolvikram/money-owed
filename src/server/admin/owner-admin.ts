// Terminal-only owner administration (provisioning and recovery).
// Imported ONLY by scripts/ and tests — never by app routes. It requires direct
// database credentials, so there is no web-reachable bootstrap or reset path.
import { sql } from "drizzle-orm";
import type pg from "pg";
import type { DB } from "../db/client";
import type { Auth } from "../auth/config";
import { checkPassphrase } from "../auth/password-policy";
import { normaliseEmail } from "../auth/login-throttle";
import { DEFAULT_CATEGORIES } from "../services/default-categories";

const PROVISION_LOCK_ID = 74_610_001; // arbitrary constant for pg_advisory_lock

export class AdminError extends Error {}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateOwnerEmail(email: string): string {
  const e = normaliseEmail(email);
  if (!EMAIL_RE.test(e) || e.length > 254) throw new AdminError("That does not look like a valid email address.");
  return e;
}

/**
 * Creates the single owner. Refuses if any owner already exists or if the email is
 * already registered (never overwrites). Concurrent runs are serialised by an
 * advisory lock, and the app_owner primary key (CHECK id = 1) makes a second
 * owner impossible even without the lock.
 */
export async function provisionOwner(
  deps: { db: DB; pool: pg.Pool; auth: Auth },
  input: { email: string; password: string; name?: string },
): Promise<{ userId: string }> {
  const email = validateOwnerEmail(input.email);
  const policy = checkPassphrase(input.password, { email });
  if (!policy.ok) throw new AdminError(policy.error);

  const lockClient = await deps.pool.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock($1)", [PROVISION_LOCK_ID]);

    const existing = await deps.db.execute(sql`SELECT 1 FROM app_owner WHERE id = 1`);
    if (existing.rows.length) throw new AdminError("An owner already exists. Use the recovery command to reset the password.");
    const emailTaken = await deps.db.execute(sql`SELECT 1 FROM "user" WHERE email = ${email}`);
    if (emailTaken.rows.length) throw new AdminError("A user with that email already exists but is not the owner. Refusing to overwrite.");

    // Same library calls Better Auth's own sign-up route uses (hash + createUser + linkAccount).
    const ctx = await deps.auth.$context;
    const hash = await ctx.password.hash(input.password);
    const user = await ctx.internalAdapter.createUser({ email, name: input.name?.trim() || "Owner", emailVerified: true }, { method: "email-password" });
    if (!user) throw new AdminError("Could not create the user.");
    try {
      await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
      await deps.db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO app_owner (id, user_id) VALUES (1, ${user.id})`);
        await tx.execute(sql`INSERT INTO owner_settings (owner_id) VALUES (${user.id})`);
        for (const c of DEFAULT_CATEGORIES) {
          await tx.execute(sql`INSERT INTO categories (owner_id, name, kind) VALUES (${user.id}, ${c.name}, ${c.kind})`);
        }
      });
    } catch (e) {
      // Compensate: remove the half-created auth user (cascades to its account row).
      await deps.db.execute(sql`DELETE FROM "user" WHERE id = ${user.id}`);
      if (e instanceof Error && /app_owner_pkey|duplicate key/.test(e.message)) {
        throw new AdminError("An owner already exists. Refusing to create a second owner.");
      }
      throw e;
    }
    return { userId: user.id };
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [PROVISION_LOCK_ID]).catch(() => undefined);
    lockClient.release();
  }
}

/** Sets a new password for the existing owner and revokes ALL of their sessions. */
export async function recoverOwner(
  deps: { db: DB; auth: Auth },
  input: { email: string; password: string },
): Promise<void> {
  const email = validateOwnerEmail(input.email);
  const res = await deps.db.execute<{ user_id: string }>(sql`
    SELECT o.user_id FROM app_owner o JOIN "user" u ON u.id = o.user_id WHERE o.id = 1 AND u.email = ${email}`);
  const userId = res.rows[0]?.user_id;
  if (!userId) throw new AdminError("No owner with that email. Nothing was changed.");
  const policy = checkPassphrase(input.password, { email });
  if (!policy.ok) throw new AdminError(policy.error);

  const ctx = await deps.auth.$context;
  const hash = await ctx.password.hash(input.password);
  const account = await ctx.internalAdapter.findCredentialAccount?.(userId);
  if (account) {
    await ctx.internalAdapter.updatePassword(userId, hash);
  } else {
    await ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
  }
  await ctx.internalAdapter.deleteUserSessions(userId);
  // Belt and braces: make sure no session row survives.
  await deps.db.execute(sql`DELETE FROM session WHERE user_id = ${userId}`);
  await deps.db.execute(sql`DELETE FROM login_throttle`);
}

/** Marks the owner disabled (all access denied) or re-enables them. */
export async function setOwnerDisabled(db: DB, disabled: boolean): Promise<void> {
  await db.execute(sql`UPDATE app_owner SET disabled_at = ${disabled ? sql`now()` : null} WHERE id = 1`);
  if (disabled) await db.execute(sql`DELETE FROM session WHERE user_id = (SELECT user_id FROM app_owner WHERE id = 1)`);
}
