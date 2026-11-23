// Drops and recreates the schema of the LOCAL TEST database only, then migrates.
// Refuses to run against anything that is not localhost/ledger_test.
import pg from "pg";
import { execSync } from "node:child_process";

const ADMIN_URL = process.env.TEST_PG_SUPERUSER_URL ?? "postgresql://postgres@localhost:54329/ledger_test";
const db = process.argv[2] ?? "ledger_test";

async function main() {
  const u = new URL(ADMIN_URL);
  if (!["localhost", "127.0.0.1"].includes(u.hostname) || !/^ledger_(test|dev)$/.test(db)) {
    console.error("Refusing: reset only works on the local ledger_test/ledger_dev database.");
    process.exit(1);
  }
  u.pathname = "/" + db;
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public AUTHORIZATION ledger_admin; REVOKE CREATE ON SCHEMA public FROM PUBLIC;");
  await c.end();
  const envFile = db === "ledger_test" ? ".env.test" : ".env.development.local";
  execSync(`npx tsx --conditions=react-server scripts/migrate.ts`, { stdio: "inherit", env: { ...process.env, LEDGER_ENV_FILE: envFile } });
}
main().catch((e) => { console.error(e.message); process.exit(1); });
