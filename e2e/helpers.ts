import { execSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";

export const OWNER_EMAIL = "owner@example.test";
export const OWNER_PASS = "fictional e2e passphrase 77";

/** Resets the local TEST database and provisions the owner via the real terminal command (stdin, not argv). */
export function resetAndProvision() {
  execSync("npx tsx scripts/reset-test-db.ts ledger_test", { stdio: "ignore" });
  execSync("npx tsx --conditions=react-server scripts/provision-owner.ts", {
    input: `${OWNER_EMAIL}\n${OWNER_PASS}\n${OWNER_PASS}\n`,
    env: { ...process.env, LEDGER_ENV_FILE: ".env.test" },
    stdio: ["pipe", "ignore", "inherit"],
  });
}

export async function login(page: Page, email = OWNER_EMAIL, password = OWNER_PASS) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Passphrase").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
}
