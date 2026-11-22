import "server-only";
import { headers } from "next/headers";
import { trustedOrigins } from "./env";
import { ServiceError } from "./services/errors";

/**
 * Same-origin check for cookie-authenticated mutations (server actions).
 * Next.js already compares Origin with Host for server actions; this adds an
 * explicit check against our exact trusted origins and rejects missing Origin.
 */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const origin = h.get("origin");
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin") throw new ServiceError("unauthorized", "Request blocked.");
  if (!origin || !trustedOrigins().includes(origin)) throw new ServiceError("unauthorized", "Request blocked.");
}

export const PRIVATE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
