import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import "../../src/server/db/pg-types";
import * as schema from "../../src/server/db/schema";
import { createAuth } from "../../src/server/auth/config";
import { deriveAuthSecret, resolveAppUrl } from "../../src/server/auth/derive";
import { strictSslUrl } from "../../src/lib/db-url";
import { requireVar } from "./env";

/** Builds terminal-side dependencies on DATABASE_URL. */
export function adminDeps() {
  const url = requireVar("DATABASE_URL");
  const pool = new pg.Pool({ connectionString: strictSslUrl(url), max: 3 });
  const db = drizzle({ client: pool, schema });
  const appUrl = resolveAppUrl();
  const auth = createAuth({
    db,
    secret: deriveAuthSecret(requireVar("ADMIN_PASSWORD"), url),
    baseURL: appUrl,
    trustedOrigins: [appUrl],
    production: false,
  });
  return { pool, db, auth, url };
}
