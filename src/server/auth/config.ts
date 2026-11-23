// Better Auth configuration factory. Imported by the web app (src/server/auth/auth.ts)
// and by tests. It deliberately contains no account-creation path: public
// sign-up is disabled server-side and its HTTP route is removed.
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { DB } from "../db/client";
import * as schema from "../db/schema";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password-policy";
import {
  checkLoginThrottle,
  recordLoginFailure,
  resetLoginThrottle,
  throttleKey,
} from "./login-throttle";

export const SESSION_SECONDS = 7 * 24 * 60 * 60;

/** Only these Better Auth HTTP endpoints are reachable. Everything else returns 404. */
export const ENABLED_AUTH_PATHS = [
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/ok",
];
const ALL_CORE_PATHS = [
  "/account-info", "/callback/:id", "/change-email", "/change-password", "/delete-user",
  "/delete-user/callback", "/error", "/get-access-token", "/get-session", "/link-social",
  "/list-accounts", "/list-sessions", "/ok", "/refresh-token", "/request-password-reset",
  "/reset-password", "/reset-password/:token", "/revoke-other-sessions", "/revoke-session",
  "/revoke-sessions", "/send-verification-email", "/sign-in/email", "/sign-in/social",
  "/sign-out", "/sign-up/email", "/unlink-account", "/update-session", "/update-user",
  "/verify-email", "/verify-password",
];
export const DISABLED_AUTH_PATHS = ALL_CORE_PATHS.filter((p) => !ENABLED_AUTH_PATHS.includes(p));

export type AuthConfigInput = {
  db: DB;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  /** Header that the hosting platform sets with the real client IP (e.g. x-vercel-forwarded-for). */
  clientIpHeader?: string;
  production: boolean;
  /**
   * Runs before every sign-in attempt. The app uses it to create or update the owner
   * from ADMIN_USERNAME / ADMIN_PASSWORD. Throwing an APIError rejects the sign-in.
   */
  beforeSignIn?: () => Promise<void>;
};

export function createAuth(cfg: AuthConfigInput) {
  return betterAuth({
    appName: "Personal Ledger",
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    trustedOrigins: cfg.trustedOrigins,
    database: drizzleAdapter(cfg.db, { provider: "pg", schema, transaction: true }),
    disabledPaths: DISABLED_AUTH_PATHS,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      // Fixed 7-day lifetime: no sliding refresh, so a session cannot live forever.
      expiresIn: SESSION_SECONDS,
      disableSessionRefresh: true,
      // Never trust a signed cookie copy of the session: every check hits the DB,
      // so revocation and owner removal take effect immediately.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true, // also in development/tests, so behaviour matches production
      storage: "database",
      modelName: "rateLimit",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 300, max: 10 },
      },
    },
    advanced: {
      // Explicit: Better Auth skips these by default when NODE_ENV=test. We never want
      // that, so origin/CSRF protection behaves the same in every environment.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      useSecureCookies: cfg.production,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: cfg.production, path: "/" },
      cookiePrefix: "ledger",
      ipAddress: {
        // Only read a header the platform controls. Empty list = no forwarded headers trusted.
        ipAddressHeaders: cfg.clientIpHeader ? [cfg.clientIpHeader] : [],
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email") {
          const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
          if (!email) return;
          const remaining = await checkLoginThrottle(cfg.db, throttleKey(email, cfg.secret));
          if (remaining > 0) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Too many sign-in attempts. Please wait and try again.",
            }, { "X-Retry-After": String(remaining) });
          }
          await cfg.beforeSignIn?.();
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
        if (!email) return;
        const key = throttleKey(email, cfg.secret);
        const returned = ctx.context.returned;
        if (isAPIError(returned)) {
          // Count only credential failures, not our own throttle rejections.
          if (returned.statusCode === 401 || returned.status === "UNAUTHORIZED") await recordLoginFailure(cfg.db, key);
        } else if (ctx.context.newSession) {
          await resetLoginThrottle(cfg.db, key);
        }
      }),
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;
