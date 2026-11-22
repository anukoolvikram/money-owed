import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { login, resetAndProvision, shot } from "./helpers";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => resetAndProvision());

async function addAccount(page: Page, name: string, opening: string) {
  await page.goto("/more/accounts");
  await page.getByLabel("Name").first().fill(name);
  await page.getByLabel("Opening balance (₹)").first().fill(opening);
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved:" })).toBeVisible();
}

test("19. end-to-end: accounts, IOUs, edit, filter, export, restore, logout", async ({ page, browser }) => {
  await login(page);
  await shot(page, "01-overview-empty-390");

  await addAccount(page, "HDFC Savings", "25000");
  await addAccount(page, "Cash in wallet", "800");
  await shot(page, "02-accounts-390");

  // Person
  await page.goto("/people");
  await page.getByLabel("Name").fill("Priya Raghunathan-Venkatasubramanian");
  await page.getByLabel("Label").fill("school friend");
  await page.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  // Validation error is shown and nothing is saved.
  await page.goto("/add");
  await page.getByLabel("Amount (₹)").fill("12.345");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Use at most two decimal places.")).toBeVisible();
  await shot(page, "03-add-validation-error-390");

  // Expenses
  await page.getByLabel("Amount (₹)").fill("250");
  await page.getByRole("button", { name: "Food" }).click();
  await page.getByLabel("Note").fill("Lunch, \"thali\"");
  await save(page);
  await page.getByLabel("Amount (₹)").fill("1,20,000.50");
  await page.getByRole("button", { name: "Shopping" }).click();
  await save(page);

  // Repeated IOUs with the same person
  for (const [type, amt] of [["I lent", "5000"], ["I lent", "2000"], ["They repaid me", "1500"], ["They repaid me", "500"]]) {
    await page.getByRole("radio", { name: type }).click();
    await page.getByLabel("Amount (₹)").fill(amt);
    await page.getByRole("radio", { name: /Priya/ }).click();
    await save(page);
  }
  await shot(page, "04-add-iou-preview-390");

  // Crossing zero asks for confirmation
  await page.getByRole("radio", { name: "They repaid me" }).click();
  await page.getByLabel("Amount (₹)").fill("6000");
  await page.getByRole("radio", { name: /Priya/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("you owe");
  await shot(page, "05-cross-zero-confirm-390");
  await page.getByRole("button", { name: "Cancel" }).click();

  // Person detail
  await page.goto("/people");
  await expect(page.getByText("owes you")).toBeVisible();
  await page.getByRole("link", { name: /Priya/ }).click();
  await expect(page.getByText(/owes you ₹5,000.00/)).toBeVisible();
  await shot(page, "06-person-detail-390");

  // Edit an entry: change the lunch to 300
  await page.goto("/transactions");
  await page.getByRole("link", { name: /Food/ }).click();
  await page.getByLabel("Amount (₹)").fill("300");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByText("−₹300.00")).toBeVisible();

  // Filter by type and search
  await page.goto("/transactions?type=lend");
  await expect(page.getByRole("link", { name: /Lent to/ })).toHaveCount(2);
  await page.goto("/transactions?q=thali");
  await expect(page.getByRole("link")).toContainText([/Food/]);
  await shot(page, "07-transactions-filtered-390");

  // Overview reflects only spending/income, not IOUs
  await page.goto("/");
  await expect(page.getByText("₹1,20,300.50").first()).toBeVisible();
  await shot(page, "08-overview-390");

  // Budget
  await page.goto("/more/budgets");
  await page.getByLabel("Overall spending limit (₹)").fill("100000");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Budget saved")).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Over by/).first()).toBeVisible();
  await shot(page, "09-budgets-over-390");

  // Export JSON backup
  await page.goto("/more/data");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download full backup (JSON)" }).click()]);
  const backupPath = await dl.path();
  const backup = JSON.parse(readFileSync(backupPath!, "utf8"));
  expect(backup.transactions).toHaveLength(6);
  const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download entries (CSV)" }).click()]);
  expect(readFileSync((await csvDl.path())!, "utf8")).toContain('"Lunch, ""thali"""');

  // Restore into an EMPTY test ledger
  resetAndProvision();
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Kolkata" });
  const p2 = await fresh.newPage();
  await login(p2);
  await p2.goto("/more/data");
  await p2.getByLabel("Backup file (.json)").setInputFiles(backupPath!);
  await expect(p2.getByText("Dry run: ready to restore")).toBeVisible();
  await p2.getByRole("button", { name: "Restore this backup" }).click();
  await p2.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
  await expect(p2.getByText("Restored 6 entries.")).toBeVisible();
  await p2.goto("/people");
  await expect(p2.getByRole("link", { name: /Priya/ })).toContainText("₹5,000.00");
  await p2.goto("/");
  await expect(p2.getByText("₹1,20,300.50").first()).toBeVisible();

  // Logout clears access
  await p2.goto("/more");
  await p2.getByRole("button", { name: "Log out" }).click();
  await expect(p2).toHaveURL(/\/login/);
  await p2.goto("/");
  await expect(p2).toHaveURL(/\/login/);
  await fresh.close();
});

test("20. screenshots: desktop, dark mode, help and login", async ({ browser }) => {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Asia/Kolkata" });
  const d = await desktop.newPage();
  await login(d);
  await shot(d, "10-overview-desktop");
  await d.goto("/transactions");
  await shot(d, "11-transactions-desktop");
  await desktop.close();

  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", timezoneId: "Asia/Kolkata" });
  const k = await dark.newPage();
  await k.goto("/login");
  await shot(k, "12-login-dark-390");
  await login(k);
  await shot(k, "13-overview-dark-390");
  await k.goto("/add");
  await shot(k, "14-add-dark-390");
  await k.goto("/people");
  await shot(k, "15-people-dark-390");
  await dark.close();

  const small = await browser.newContext({ viewport: { width: 320, height: 640 }, timezoneId: "Asia/Kolkata" });
  const s = await small.newPage();
  await login(s);
  await s.goto("/add");
  const overflow = await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await shot(s, "16-add-320");
  // What a phone actually shows: viewport only, scrolled to the end (Note above Save, above the nav).
  await s.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await s.screenshot({ path: "e2e/screenshots/16b-add-320-viewport-bottom.png" });
  const note = await s.getByLabel("Note").boundingBox();
  const saveBtn = await s.getByRole("button", { name: "Save", exact: true }).boundingBox();
  expect(note!.y + note!.height).toBeLessThanOrEqual(saveBtn!.y);
  await s.goto("/");
  expect(await s.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await shot(s, "17-overview-320");
  await small.close();
});
