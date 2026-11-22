import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import "../../src/server/db/pg-types";
import * as schema from "../../src/server/db/schema";
import { createAuth } from "../../src/server/auth/config";
import { requireVar } from "./env";

/** Builds admin dependencies on the MIGRATION/admin connection. */
export function adminDeps() {
  const url = requireVar("MIGRATION_DATABASE_URL");
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  const db = drizzle({ client: pool, schema });
  const auth = createAuth({
    db,
    secret: requireVar("BETTER_AUTH_SECRET"),
    baseURL: requireVar("BETTER_AUTH_URL"),
    trustedOrigins: [new URL(requireVar("BETTER_AUTH_URL")).origin],
    production: false,
  });
  return { pool, db, auth, url };
}
