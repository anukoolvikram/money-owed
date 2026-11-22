import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createHarness, idem, makeOwner, resetAll, type Harness } from "../helpers/db";
import type { OwnerContext } from "@/server/auth/owner";
import { createAccount, listAccounts, updateAccount, getAccount } from "@/server/services/accounts";
import { createPerson, listPeople } from "@/server/services/people";
import { listCategories } from "@/server/services/categories";
import { createTransaction, listTransactions } from "@/server/services/transactions";
import { getBudgetView, setBudget } from "@/server/services/budgets";
import { updateSettings } from "@/server/services/settings";
import { commitRestore, exportBackup, previewRestore } from "@/server/services/backup";
import { commitCsvImport, exportTransactionsCsv, previewCsvImport } from "@/server/services/csv-io";
import { ServiceError } from "@/server/services/errors";
import { addDays, cycleFor, todayIn } from "@/lib/dates";
import { parseCsv } from "@/lib/csv";

let h: Harness;
let owner: OwnerContext;
const TODAY = todayIn("Asia/Kolkata");
const D = (n: number) => addDays(TODAY, -n);

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetAll(h);
  owner = await makeOwner(h);
});

async function seedLedger() {
  await updateSettings(h.db, owner, { timezone: "Asia/Kolkata", cycleStartDay: 25, theme: "dark" });
  const bank = (await createAccount(h.db, owner, { name: "Bank, \"main\"", kind: "bank", openingBalance: "1234.56", openingDate: D(90) })).id;
  const cash = (await createAccount(h.db, owner, { name: "Cash", kind: "cash", openingBalance: "-10", openingDate: D(90) })).id;
  const a = await getAccount(h.db, owner, cash);
  await updateAccount(h.db, owner, { id: cash, version: a.version, name: "Cash", kind: "cash", openingBalance: "100", openingDate: D(90), confirmOpeningChange: true });
  const cats = await listCategories(h.db, owner);
  const food = cats.find((c) => c.name === "Food")!.id;
  const sal = cats.find((c) => c.name === "Salary")!.id;
  const p1 = (await createPerson(h.db, owner, { name: "Ravi", label: "college", openingIou: "250", openingDate: D(90) })).id;
  const p2 = (await createPerson(h.db, owner, { name: "Ravi", label: "office", openingIou: "-99.99", openingDate: D(90) })).id;
  const add = (f: Record<string, unknown>) => createTransaction(h.db, owner, { accountId: bank, idempotencyKey: idem(), ...f });
  await add({ type: "income", amount: "50000", categoryId: sal, date: D(40) });
  await add({ type: "expense", amount: "0.01", categoryId: food, date: D(39), note: "=HYPERLINK(\"http://evil\",\"x\")" });
  await add({ type: "expense", amount: "199.99", categoryId: food, date: D(2), note: "चाय, \"special\"\nline 2", paymentMethod: "upi" });
  await add({ type: "transfer", amount: "500", toAccountId: cash, date: D(10) });
  await add({ type: "lend", amount: "5000", personId: p1, date: D(30) });
  await add({ type: "repayment_received", amount: "1000", personId: p1, date: D(5) });
  await add({ type: "borrow", amount: "300", personId: p2, date: D(3), accountId: cash });
  const prev = cycleFor(addDays(cycleFor(TODAY, 25).start, -1), 25);
  await setBudget(h.db, owner, { periodStart: prev.start, overall: "20000", categoryLimits: [{ categoryId: food, limit: "3000" }] });
  await setBudget(h.db, owner, { periodStart: cycleFor(TODAY, 25).start, overall: "25000", categoryLimits: [] });
  return { prev };
}

async function snapshot(o: OwnerContext) {
  const accounts = (await listAccounts(h.db, o, { includeArchived: true })).map((a) => [a.name, a.balancePaise, a.openingBalancePaise, a.openingDate]);
  const people = (await listPeople(h.db, o, { includeArchived: true })).map((p) => [p.name, p.label, p.netPaise, p.openingIouPaise]);
  const tx = (await listTransactions(h.db, o, {}, 1000)).items.map((t) => [t.date, t.type, t.amountPaise, t.accountName, t.toAccountName, t.categoryName, t.personLabel, t.note, t.paymentMethod]);
  return { accounts, people, tx };
}

describe("12. JSON backup and restore", () => {
  it("round-trips balances, history and historical budgets exactly", async () => {
    const { prev } = await seedLedger();
    const before = await snapshot(owner);
    const prevBudget = await getBudgetView(h.db, owner, prev);
    const backup = await exportBackup(h.db, owner);
    const text = JSON.stringify(backup);
    // No secrets or owner identifiers in the backup.
    expect(text).not.toContain(owner.ownerId);
    expect(text).not.toContain("owner@example.test");
    const keys = new Set<string>();
    JSON.parse(text, (k, v) => (keys.add(k), v));
    for (const k of keys) expect(k).not.toMatch(/password|session|token|hash|secret|owner|user|email/i);

    // Fresh database, fresh owner, restore.
    await resetAll(h);
    owner = await makeOwner(h, "restored@example.test");
    const { preview } = await previewRestore(h.db, owner, text);
    expect(preview.errors).toEqual([]);
    await commitRestore(h.db, owner, text);
    expect(await snapshot(owner)).toEqual(before);
    // IDs are remapped on restore, so compare everything except ids.
    const noIds = (v: Awaited<ReturnType<typeof getBudgetView>>) => ({ ...v, categories: v.categories.map((c) => ({ ...c, categoryId: undefined })) });
    expect(noIds(await getBudgetView(h.db, owner, prev))).toEqual(noIds(prevBudget));
    // The restored backup re-exports identically (apart from generated ids/timestamps).
    const again = await exportBackup(h.db, owner);
    expect(again.transactions.map((t) => t.note)).toEqual(backup.transactions.map((t) => t.note));
    expect(again.openingChanges).toHaveLength(1);
    // Repeating the same restore is refused (ledger not empty / already restored), nothing duplicated.
    await expect(commitRestore(h.db, owner, text)).rejects.toBeInstanceOf(ServiceError);
    expect((await listTransactions(h.db, owner, {}, 1000)).items).toHaveLength(before.tx.length);
  });

  it("rejects corrupt, oversized and inconsistent backups with no partial writes", async () => {
    await seedLedger();
    const good = await exportBackup(h.db, owner);
    await resetAll(h);
    owner = await makeOwner(h);
    const count = async () => (await h.adminDb.execute<{ n: number }>(sql`SELECT (SELECT count(*) FROM transactions) + (SELECT count(*) FROM accounts) AS n`)).rows[0].n;

    for (const bad of [
      "not json",
      JSON.stringify({ ...good, version: 99 }),
      JSON.stringify({ ...good, transactions: [...good.transactions, { ...good.transactions[0], id: "dangling", accountId: "missing" }] }),
      JSON.stringify({ ...good, transactions: [{ ...good.transactions[0], amountPaise: "1.5" }] }),
      JSON.stringify({ ...good, transactions: [{ ...good.transactions[0], date: addDays(TODAY, 3) }] }),
      JSON.stringify({ ...good, ownerId: "someone-else" }) + " ".repeat(1_600_000),
    ]) {
      await expect(commitRestore(h.db, owner, bad)).rejects.toBeInstanceOf(ServiceError);
      expect(Number(await count())).toBe(0);
    }
    // Owner ids inside a backup are ignored: rows always belong to the signed-in owner.
    const withForeignOwner = JSON.stringify({ ...good, ownerId: "attacker", accounts: good.accounts.map((a) => ({ ...a, ownerId: "attacker" })) });
    await commitRestore(h.db, owner, withForeignOwner);
    const foreign = await h.adminDb.execute(sql`SELECT 1 FROM accounts WHERE owner_id <> ${owner.ownerId}`);
    expect(foreign.rows).toHaveLength(0);
  });

  it("refuses to restore into a non-empty ledger", async () => {
    await seedLedger();
    const text = JSON.stringify(await exportBackup(h.db, owner));
    const { preview } = await previewRestore(h.db, owner, text);
    expect(preview.ok).toBe(false);
    expect(preview.errors.join(" ")).toMatch(/empty ledger/);
  });
});

describe("CSV export and import", () => {
  it("exports inert formulas and quoted fields", async () => {
    await seedLedger();
    const csv = await exportTransactionsCsv(h.db, owner);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
    const parsed = parseCsv(csv);
    if (!parsed.ok) throw new Error();
    expect(parsed.rows[0]).toEqual(["date", "type", "amount", "account", "to_account", "category", "person", "person_label", "payment_method", "note"]);
    expect(parsed.rows.some((r) => r[9] === "चाय, \"special\"\nline 2")).toBe(true);
    expect(parsed.rows.some((r) => r[3] === 'Bank, "main"')).toBe(true);
  });

  it("template import previews row errors, never skips, and is idempotent", async () => {
    const bank = (await createAccount(h.db, owner, { name: "HDFC", kind: "bank", openingBalance: "0", openingDate: D(30) })).id;
    await createPerson(h.db, owner, { name: "Meera", openingIou: "0", openingDate: D(30) });
    const csv = [
      "date,type,amount,account,to_account,category,person,note",
      `${D(5)},expense,120.50,HDFC,,Food,,ok row`,
      `${D(4)},lend,2000,HDFC,,,Meera,`,
      `${D(3)},repayment_received,500,HDFC,,,Meera,`,
      `${D(2)},expense,1.234,HDFC,,Food,,bad decimals`,
      `${D(2)},salary,10,HDFC,,,,bad type`,
      `${addDays(TODAY, 2)},expense,10,HDFC,,Food,,future`,
    ].join("\n");
    const { preview } = await previewCsvImport(h.db, owner, csv, { mode: "template" });
    expect(preview.ok).toBe(false);
    expect(preview.rows.filter((r) => r.errors.length).map((r) => r.line)).toEqual([5, 6, 7]);
    await expect(commitCsvImport(h.db, owner, csv, { mode: "template" })).rejects.toBeInstanceOf(ServiceError);
    expect((await listTransactions(h.db, owner, {})).items).toHaveLength(0);

    const good = csv.split("\n").slice(0, 4).join("\n");
    const r = await commitCsvImport(h.db, owner, good, { mode: "template" });
    expect(r.inserted).toBe(3);
    await expect(commitCsvImport(h.db, owner, good, { mode: "template" })).rejects.toThrow(/already imported/);
    expect((await listTransactions(h.db, owner, {})).items).toHaveLength(3);
    // Duplicate warning for the same data in a different file.
    const { preview: p2 } = await previewCsvImport(h.db, owner, good + "\n", { mode: "template" });
    expect(p2.warningCount).toBeGreaterThanOrEqual(3);
    expect(bank).toBeTruthy();
  });

  it("maps an old sheet only with explicit types and creates people deliberately", async () => {
    await createAccount(h.db, owner, { name: "SBI", kind: "bank", openingBalance: "10000", openingDate: D(60) });
    const sheet = ["Date,Person,Money out,Money in,Note", `${D(20).split("-").reverse().join("/")},Kiran,3000,,loan`, `${D(10).split("-").reverse().join("/")},Kiran,,1000,part`, `${D(9).split("-").reverse().join("/")},Kiran,5,5,both`].join("\n");
    const base = { mode: "sheet", dateFormat: "DD/MM/YYYY", columns: { date: "Date", person: "Person", moneyOut: "Money out", moneyIn: "Money in", note: "Note" }, accountName: "SBI", outType: "lend", inType: "repayment_received" };
    const noCreate = await previewCsvImport(h.db, owner, sheet, base);
    expect(noCreate.preview.ok).toBe(false);
    const fixed = sheet.split("\n").slice(0, 3).join("\n");
    const withCreate = await previewCsvImport(h.db, owner, fixed, { ...base, createMissingPeople: true });
    expect(withCreate.preview.ok).toBe(true);
    expect(withCreate.preview.newPeople).toEqual(["Kiran"]);
    await commitCsvImport(h.db, owner, fixed, { ...base, createMissingPeople: true });
    const ppl = await listPeople(h.db, owner);
    expect(ppl.map((p) => [p.name, p.netPaise])).toEqual([["Kiran", "200000"]]);
  });

  it("rejects oversize files and too many rows before writing", async () => {
    const big = "date,type,amount,account\n" + "x".repeat(1_100_000);
    expect((await previewCsvImport(h.db, owner, big, { mode: "template" })).preview.fileError).toMatch(/1 MB/);
    const many = "date,type,amount,account\n" + Array.from({ length: 5001 }, () => "2026-01-01,expense,1,A").join("\n");
    expect((await previewCsvImport(h.db, owner, many, { mode: "template" })).preview.fileError).toMatch(/Too many rows/);
  });
});
