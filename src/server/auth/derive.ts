// Pure helpers that turn the three configured variables (DATABASE_URL,
// ADMIN_USERNAME, ADMIN_PASSWORD) plus platform-provided values into the
// settings Better Auth needs. No values are ever logged.
import { hkdfSync } from "node:crypto";

/**
 * Cookie-signing secret, derived from ADMIN_PASSWORD with DATABASE_URL as salt.
 * Changing ADMIN_PASSWORD therefore also rotates the secret, which signs out
 * every existing session.
 */
export function deriveAuthSecret(adminPassword: string, databaseUrl: string): string {
  const key = hkdfSync("sha256", adminPassword, databaseUrl, "personal-ledger/auth-secret/v1", 32);
  return Buffer.from(key).toString("hex");
}

type PlatformEnv = Record<string, string | undefined>;

/**
 * The public origin of the app. On Vercel this comes from Vercel's automatic
 * system variables; locally it is http://localhost:<PORT>. APP_URL is an
 * optional override, only needed on hosts other than Vercel.
 */
export function resolveAppUrl(e: PlatformEnv = process.env): string {
  if (e.APP_URL) return new URL(e.APP_URL).origin;
  if (e.VERCEL_ENV === "production" && e.VERCEL_PROJECT_PRODUCTION_URL) return `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (e.VERCEL_URL) return `https://${e.VERCEL_URL}`;
  return `http://localhost:${e.PORT || "3000"}`;
}

/** Exact origins allowed to make cookie-authenticated requests. No wildcards. */
export function resolveTrustedOrigins(e: PlatformEnv = process.env): string[] {
  const hosts = [e.VERCEL_PROJECT_PRODUCTION_URL, e.VERCEL_URL, e.VERCEL_BRANCH_URL].filter(Boolean).map((h) => `https://${h}`);
  const all = [resolveAppUrl(e), ...hosts].map((o) => new URL(o).origin);
  for (const o of all) if (o.includes("*")) throw new Error("Wildcard trusted origins are not allowed");
  return [...new Set(all)];
}

/** Only trust a client-IP header that the platform itself sets. */
export function resolveClientIpHeader(e: PlatformEnv = process.env): string | undefined {
  return e.VERCEL ? "x-vercel-forwarded-for" : undefined;
}
