import { execSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";

// Must match ADMIN_USERNAME / ADMIN_PASSWORD in .env.test (fictional).
export const OWNER_USERNAME = "owner";
export const OWNER_EMAIL = "owner@owner.invalid"; // internal login for that username
export const OWNER_PASS = "fictional e2e passphrase 77";

/**
 * Resets the local TEST database. There is no provisioning step any more: the
 * owner is created from ADMIN_USERNAME / ADMIN_PASSWORD on the first sign-in
 * (the server re-syncs when it finds the owner row missing after a reset).
 */
export function resetAndProvision() {
  execSync("npx tsx scripts/reset-test-db.ts ledger_test", { stdio: "ignore" });
}

export async function login(page: Page, username = OWNER_USERNAME, password = OWNER_PASS) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
}
