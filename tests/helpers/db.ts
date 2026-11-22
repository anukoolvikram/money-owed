// Integration-test harness. Connects to the LOCAL test database only:
// - `db` uses the least-privilege runtime role (ledger_app), like the app
// - `adminDb` uses the migration role, only for provisioning and cleanup
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import "@/server/db/pg-types";
import * as schema from "@/server/db/schema";
import { createAuth } from "@/server/auth/config";
import { provisionOwner } from "@/server/admin/owner-admin";
import { resolveOwner, type OwnerContext } from "@/server/auth/owner";
import type { DB } from "@/server/db/client";

function assertTestDb(url: string | undefined): string {
  if (!url) throw new Error("Test DB URL missing");
  const u = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || !u.pathname.endsWith("_test"))
    throw new Error("Refusing to run integration tests against a non-test database");
  return url;
}

export const TEST_PASSWORD = "fictional test passphrase 42";
export const TEST_EMAIL = "owner@example.test";

export type Harness = {
  appPool: pg.Pool;
  adminPool: pg.Pool;
  db: DB;
  adminDb: DB;
  auth: ReturnType<typeof createAuth>;
  adminAuth: ReturnType<typeof createAuth>;
  close: () => Promise<void>;
};

export function createHarness(): Harness {
  const appPool = new pg.Pool({ connectionString: assertTestDb(process.env.DATABASE_URL), max: 10 });
  const adminPool = new pg.Pool({ connectionString: assertTestDb(process.env.MIGRATION_DATABASE_URL), max: 5 });
  const db = drizzle({ client: appPool, schema });
  const adminDb = drizzle({ client: adminPool, schema });
  const base = {
    secret: process.env.BETTER_AUTH_SECRET!,
    baseURL: process.env.BETTER_AUTH_URL!,
    trustedOrigins: [process.env.BETTER_AUTH_URL!],
    production: false,
  };
  return {
    appPool,
    adminPool,
    db,
    adminDb,
    auth: createAuth({ db, ...base }),
    adminAuth: createAuth({ db: adminDb, ...base }),
    close: async () => {
      await appPool.end();
      await adminPool.end();
    },
  };
}

const TABLES = [
  "budget_category_limits", "budget_periods", "transactions", "import_batches", "opening_changes",
  "people", "categories", "accounts", "owner_settings", "app_owner", "login_throttle",
  "rate_limit", "verification", "session", "account", '"user"',
];

export async function resetAll(h: Harness): Promise<void> {
  await h.adminDb.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} CASCADE`));
}

/** Provisions the fictional test owner and returns its context. */
export async function makeOwner(h: Harness, email = TEST_EMAIL): Promise<OwnerContext> {
  const { userId } = await provisionOwner({ db: h.adminDb, pool: h.adminPool, auth: h.adminAuth }, { email, password: TEST_PASSWORD });
  const ctx = await resolveOwner(h.db, userId, "test-session");
  if (!ctx) throw new Error("owner not resolved");
  return ctx;
}

/** Creates a second auth user that is NOT the app owner (simulates a stray account). */
export async function makeStrayUser(h: Harness, email = "stray@example.test"): Promise<string> {
  const ctx = await h.adminAuth.$context;
  const user = await ctx.internalAdapter.createUser({ email, name: "Stray", emailVerified: true }, { method: "email-password" });
  await ctx.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await ctx.password.hash(TEST_PASSWORD) });
  return user.id;
}

let n = 0;
export const idem = () => `test-${Date.now()}-${++n}-${Math.random().toString(36).slice(2)}`;
