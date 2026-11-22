import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  TRUSTED_ORIGINS: z.string().optional(),
  AUTH_CLIENT_IP_HEADER: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

/** Reads and validates server-only environment variables. Never logs values. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing server environment variables: ${names}`);
  }
  const u = new URL(parsed.data.BETTER_AUTH_URL);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (parsed.data.NODE_ENV === "production" && u.protocol !== "https:" && !local) {
    throw new Error("BETTER_AUTH_URL must use https:// in production");
  }
  cached = parsed.data;
  return cached;
}

/** Exact origins allowed to make cookie-authenticated requests. No wildcards. */
export function trustedOrigins(): string[] {
  const e = env();
  const extra = (e.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const all = [new URL(e.BETTER_AUTH_URL).origin, ...extra.map((o) => new URL(o).origin)];
  for (const o of all) if (o.includes("*")) throw new Error("Wildcard trusted origins are not allowed");
  return [...new Set(all)];
}
