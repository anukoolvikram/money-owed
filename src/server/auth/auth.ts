import "server-only";
import { createAuth, type Auth } from "./config";
import { db } from "../db/client";
import { env, trustedOrigins } from "../env";

let _auth: Auth | undefined;

/** The web app's Better Auth instance (created lazily so builds need no secrets). */
export function auth(): Auth {
  if (_auth) return _auth;
  const e = env();
  _auth = createAuth({
    db: db(),
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.BETTER_AUTH_URL,
    trustedOrigins: trustedOrigins(),
    clientIpHeader: e.AUTH_CLIENT_IP_HEADER || undefined,
    // Secure cookies whenever the app is served over HTTPS (always in real deployments).
    production: e.BETTER_AUTH_URL.startsWith("https://"),
  });
  return _auth;
}
