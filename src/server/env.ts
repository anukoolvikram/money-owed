import "server-only";
import { z } from "zod";
import { deriveAuthSecret, resolveAppUrl, resolveClientIpHeader, resolveTrustedOrigins } from "./auth/derive";

// The only variables you set: DATABASE_URL, ADMIN_USERNAME, ADMIN_PASSWORD.
// Everything else is derived (see ./auth/derive.ts).
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ADMIN_USERNAME: z.string().trim().min(1, "ADMIN_USERNAME is required").max(100),
  ADMIN_PASSWORD: z.string().min(1, "ADMIN_PASSWORD is required").max(128),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof schema> & {
  appUrl: string;
  authSecret: string;
  clientIpHeader?: string;
};

let cached: ServerEnv | undefined;

/** Reads and validates server-only environment variables. Never logs values. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing server environment variables: ${names}`);
  }
  const appUrl = resolveAppUrl();
  const u = new URL(appUrl);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (parsed.data.NODE_ENV === "production" && u.protocol !== "https:" && !local) {
    throw new Error("The app URL must use https:// in production");
  }
  cached = {
    ...parsed.data,
    appUrl,
    authSecret: deriveAuthSecret(parsed.data.ADMIN_PASSWORD, parsed.data.DATABASE_URL),
    clientIpHeader: resolveClientIpHeader(),
  };
  return cached;
}

export function trustedOrigins(): string[] {
  return resolveTrustedOrigins();
}
