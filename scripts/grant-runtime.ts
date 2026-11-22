// Grants the least-privilege runtime role data access (no DDL, no superuser).
// Usage: npm run db:grant -- <runtime_role_name>
// Run after migrations, with the MIGRATION role (the schema/table owner).
import pg from "pg";
import { describeDbUrl, loadEnvFile, requireVar } from "./lib/env";

async function main() {
  loadEnvFile();
  const role = process.argv[2];
  if (!role || !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    console.error("Usage: npm run db:grant -- <runtime_role_name>   (lowercase letters, digits, _)");
    process.exit(1);
  }
  const url = requireVar("MIGRATION_DATABASE_URL");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const r = await client.query("SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = $1", [role]);
    if (!r.rows[0]) throw new Error(`Role ${role} does not exist. Create it first (see README).`);
    if (r.rows[0].rolsuper || r.rows[0].rolcreaterole) throw new Error(`Role ${role} is too privileged for runtime use.`);
    const q = (s: string) => client.query(s.replaceAll("$ROLE", `"${role}"`));
    await q("BEGIN");
    await q("REVOKE ALL ON SCHEMA public FROM $ROLE");
    await q("GRANT USAGE ON SCHEMA public TO $ROLE");
    await q("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM $ROLE");
    await q("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $ROLE");
    await q("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $ROLE");
    // The migration journal lives in the "drizzle" schema; the runtime gets no grant there.
    await q("COMMIT");
    console.log(`Granted data-only privileges to ${role} on ${describeDbUrl(url)}.`);
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("Grant failed:", e instanceof Error ? e.message : "unknown error");
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
main();
