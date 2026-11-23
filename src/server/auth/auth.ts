import "server-only";
import { APIError } from "better-auth/api";
import { sql } from "drizzle-orm";
import { createAuth, type Auth } from "./config";
import { db, getPool } from "../db/client";
import { env, trustedOrigins } from "../env";
import { AdminError, syncOwnerFromEnv } from "../admin/owner-admin";

let _auth: Auth | undefined;
let synced: Promise<void> | undefined;

/**
 * Creates or updates the owner from ADMIN_USERNAME / ADMIN_PASSWORD once per server
 * instance (a redeploy with new values starts fresh instances). If the owner row has
 * since disappeared (database reset), it syncs again. Failures are not cached.
 */
async function ensureOwnerSynced(): Promise<void> {
  if (synced) {
    await synced.catch(() => undefined);
    const exists = await db().execute(sql`SELECT 1 FROM app_owner WHERE id = 1`);
    if (!exists.rows.length) synced = undefined;
  }
  synced ??= (async () => {
    const e = env();
    await syncOwnerFromEnv({ db: db(), pool: getPool(), auth: auth() }, { username: e.ADMIN_USERNAME, password: e.ADMIN_PASSWORD });
  })().catch((err) => {
    synced = undefined;
    if (err instanceof AdminError) {
      console.error(`[auth] owner setup refused: ${err.message}`);
      throw new APIError("SERVICE_UNAVAILABLE", { message: `Sign-in is not set up yet. ${err.message}` });
    }
    console.error("[auth] owner setup failed");
    throw new APIError("SERVICE_UNAVAILABLE", { message: "Sign-in is not available right now. Please try again." });
  });
  return synced;
}

/** The web app's Better Auth instance (created lazily so builds need no secrets). */
export function auth(): Auth {
  if (_auth) return _auth;
  const e = env();
  _auth = createAuth({
    db: db(),
    secret: e.authSecret,
    baseURL: e.appUrl,
    trustedOrigins: trustedOrigins(),
    clientIpHeader: e.clientIpHeader,
    // Secure cookies whenever the app is served over HTTPS (always in real deployments).
    production: e.appUrl.startsWith("https://"),
    beforeSignIn: ensureOwnerSynced,
  });
  return _auth;
}
