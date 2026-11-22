// Creates the single app owner. Run from a trusted terminal: npm run owner:provision
import { AdminError, provisionOwner } from "../src/server/admin/owner-admin";
import { adminDeps } from "./lib/admin-deps";
import { describeDbUrl, loadEnvFile } from "./lib/env";
import { ask, askHidden } from "./lib/prompt";

async function main() {
  const file = loadEnvFile();
  const deps = adminDeps();
  console.log(`Provisioning the owner on ${describeDbUrl(deps.url)} (env: ${file}).`);
  console.log("Use a passphrase of at least 15 characters. Spaces are fine. It will not be shown.");
  try {
    const email = (await ask("Owner email: ")).trim();
    const password = await askHidden("Passphrase: ");
    const confirm = await askHidden("Repeat passphrase: ");
    if (password !== confirm) throw new AdminError("The passphrases did not match. Nothing was created.");
    await provisionOwner(deps, { email, password });
    console.log("Owner created. You can now sign in at the app's /login page.");
  } catch (e) {
    console.error(e instanceof AdminError ? e.message : "Provisioning failed. No owner was created.");
    process.exitCode = 1;
  } finally {
    await deps.pool.end();
  }
}
main();
