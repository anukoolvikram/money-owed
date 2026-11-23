import "server-only";
import { attachDatabasePool } from "@vercel/functions";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { pg } from "./pg-types";
import * as schema from "./schema";
import { env } from "../env";
import { strictSslUrl } from "@/lib/db-url";

export type DB = NodePgDatabase<typeof schema>;

declare global {
  var __ledgerPool: pg.Pool | undefined;
}

function createPool(): pg.Pool {
  const pool = new pg.Pool({
    connectionString: strictSslUrl(env().DATABASE_URL),
    // Small pool: Fluid compute reuses instances; Neon's pooler (PgBouncer) multiplexes.
    max: 5,
    // Opening a connection to a distant database takes seconds (TLS + auth round
    // trips), so keep idle connections around instead of reopening one for nearly
    // every click. On Vercel, attachDatabasePool still closes them before suspend.
    idleTimeoutMillis: 10 * 60_000,
    keepAlive: true,
    connectionTimeoutMillis: 15_000,
  });
  pool.on("error", () => {
    // Never log connection strings or query parameters.
    console.error("[db] idle client error");
  });
  // Lets Vercel close idle clients before the instance is suspended.
  attachDatabasePool(pool);
  return pool;
}

export function getPool(): pg.Pool {
  if (!globalThis.__ledgerPool) globalThis.__ledgerPool = createPool();
  return globalThis.__ledgerPool;
}

let _db: DB | undefined;
export function db(): DB {
  if (!_db) _db = drizzle({ client: getPool(), schema });
  return _db;
}
