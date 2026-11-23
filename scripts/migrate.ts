// Applies versioned SQL migrations from ./drizzle to DATABASE_URL.
// Run deliberately from a trusted terminal: `npm run db:migrate`.
// Never run automatically in requests or in parallel Vercel builds.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { describeDbUrl, loadEnvFile, requireVar } from "./lib/env";
import { strictSslUrl } from "../src/lib/db-url";

async function main() {
  const file = loadEnvFile();
  const url = requireVar("DATABASE_URL");
  console.log(`Applying migrations to ${describeDbUrl(url)} (env: ${file})`);
  const pool = new pg.Pool({ connectionString: strictSslUrl(url), max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : "unknown error");
  process.exit(1);
});
