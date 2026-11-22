// Builds and starts the app against the isolated TEST database for Playwright.
import { readFileSync } from "node:fs";
import { spawn, execSync } from "node:child_process";

const env = { ...process.env };
for (const line of readFileSync(".env.test", "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
  if (m && !line.trim().startsWith("#")) env[m[1]] = m[2];
}
if (!/localhost:54329\/ledger_test/.test(env.DATABASE_URL)) throw new Error("e2e must use the local test database");
execSync("npx next build", { stdio: "inherit", env: { ...env, NEXT_DIST_DIR: ".next" } });
const child = spawn("npx", ["next", "start", "-p", "3100"], { stdio: "inherit", env });
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
