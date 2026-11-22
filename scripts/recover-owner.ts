// Resets the owner's password and revokes every session. Requires direct database
// access (MIGRATION_DATABASE_URL), so it cannot be triggered from the web.
// Run: npm run owner:recover
import { AdminError, recoverOwner } from "../src/server/admin/owner-admin";
import { adminDeps } from "./lib/admin-deps";
import { describeDbUrl, loadEnvFile } from "./lib/env";
import { ask, askHidden } from "./lib/prompt";

async function main() {
  const file = loadEnvFile();
  const deps = adminDeps();
  console.log(`Owner recovery on ${describeDbUrl(deps.url)} (env: ${file}).`);
  try {
    const email = (await ask("Existing owner email: ")).trim();
    const password = await askHidden("New passphrase: ");
    const confirm = await askHidden("Repeat new passphrase: ");
    if (password !== confirm) throw new AdminError("The passphrases did not match. Nothing was changed.");
    await recoverOwner(deps, { email, password });
    console.log("Password reset. All existing sessions were signed out.");
  } catch (e) {
    console.error(e instanceof AdminError ? e.message : "Recovery failed. Nothing was changed.");
    process.exitCode = 1;
  } finally {
    await deps.pool.end();
  }
}
main();
