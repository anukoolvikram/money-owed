import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createHarness, idem, makeOwner, resetAll, type Harness } from "../helpers/db";
import type { OwnerContext } from "@/server/auth/owner";
import { createAccount, getAccount, listAccounts, updateAccount } from "@/server/services/accounts";
import { createPerson, getIouTotals, getPersonDetail, listPeople, updatePerson } from "@/server/services/people";
import { listCategories } from "@/server/services/categories";
import { createTransaction, deleteTransaction, getTransaction, listTransactions, updateTransaction } from "@/server/services/transactions";
import { getBudgetView, setBudget } from "@/server/services/budgets";
import { getOverview, incomeExpense } from "@/server/services/overview";
import { updateSettings } from "@/server/services/settings";
import { ServiceError } from "@/server/services/errors";
import { cycleFor, todayIn, addDays } from "@/lib/dates";

let h: Harness;
let owner: OwnerContext;
let bank: string;
let cash: string;
let food: string;
let salary: string;
const TODAY = todayIn("Asia/Kolkata");
const D = (offset = 0) => addDays(TODAY, -offset);
const OPEN = D(400);

async function add(fields: Record<string, unknown>) {
  return createTransaction(h.db, owner, { date: D(1), accountId: bank, idempotencyKey: idem(), ...fields });
}
async function expectErr(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceError);
    expect((e as ServiceError).code).toBe(code);
    return e as ServiceError;
  }
  throw new Error(`expected ${code} error`);
}
const net = async (personId: string) => BigInt((await getPersonDetail(h.db, owner, personId)).person.netPaise);
const bal = async (id: string) => BigInt((await getAccount(h.db, owner, id)).balancePaise);
const allCycle = () => ({ start: "1900-01-01", end: "2200-01-01" });

beforeAll(async () => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetAll(h);
  owner = await makeOwner(h);
  bank = (await createAccount(h.db, owner, { name: "Test Bank", kind: "bank", openingBalance: "50000", openingDate: OPEN })).id;
  cash = (await createAccount(h.db, owner, { name: "Wallet cash", kind: "cash", openingBalance: "0", openingDate: OPEN })).id;
  const cats = await listCategories(h.db, owner);
  food = cats.find((c) => c.name === "Food")!.id;
  salary = cats.find((c) => c.name === "Salary")!.id;
});

describe("1-3. IOUs", () => {
  it("1. repeated lending and partial repayments from one person", async () => {
    const p = (await createPerson(h.db, owner, { name: "Asha", openingIou: "0", openingDate: OPEN })).id;
    await add({ type: "lend", amount: "5000", personId: p });
    await add({ type: "lend", amount: "2000", personId: p });
    await add({ type: "repayment_received", amount: "1500", personId: p });
    await add({ type: "repayment_received", amount: "500", personId: p });
    expect(await net(p)).toBe(500000n);
    expect(await incomeExpense(h.db, owner.ownerId, allCycle())).toEqual({ incomePaise: "0", expensePaise: "0" });
    expect(await bal(bank)).toBe(5000000n - 500000n);
    const detail = await getPersonDetail(h.db, owner, p);
    expect(detail.history).toHaveLength(4);
    expect(detail.history[0].runningPaise).toBe("500000");
  });

  it("2. borrowing then partial repayment is not income or spending", async () => {
    const p = (await createPerson(h.db, owner, { name: "Bala", openingIou: "0", openingDate: OPEN })).id;
    await add({ type: "borrow", amount: "3000", personId: p });
    await add({ type: "repayment_paid", amount: "1000", personId: p });
    expect(await net(p)).toBe(-200000n);
    expect(await getIouTotals(h.db, owner)).toEqual({ owedToMe: 0n, iOwe: 200000n });
    expect(await incomeExpense(h.db, owner.ownerId, allCycle())).toEqual({ incomePaise: "0", expensePaise: "0" });
  });

  it("3. both directions with the same person net to one signed balance", async () => {
    const p = (await createPerson(h.db, owner, { name: "Chetan", openingIou: "0", openingDate: OPEN })).id;
    await add({ type: "lend", amount: "2000", personId: p });
    await add({ type: "borrow", amount: "500", personId: p });
    expect(await net(p)).toBe(150000n);
    expect((await getPersonDetail(h.db, owner, p)).history).toHaveLength(2);
  });

  it("4. full repayment settles; crossing zero needs confirmation and keeps the sign", async () => {
    const p = (await createPerson(h.db, owner, { name: "Divya", openingIou: "0", openingDate: OPEN })).id;
    await add({ type: "lend", amount: "1000", personId: p });
    await add({ type: "repayment_received", amount: "1000", personId: p });
    expect(await net(p)).toBe(0n);
    expect((await listPeople(h.db, owner, { filter: "settled" })).map((x) => x.id)).toContain(p);

    await add({ type: "lend", amount: "1000", personId: p });
    const key = idem();
    const e = await expectErr(add({ type: "repayment_received", amount: "1200", personId: p, idempotencyKey: key }), "needs_confirmation");
    expect(e.details).toEqual({ beforePaise: "100000", afterPaise: "-20000" });
    expect(await net(p)).toBe(100000n); // nothing saved
    const r = await add({ type: "repayment_received", amount: "1200", personId: p, idempotencyKey: key, confirmCrossZero: true });
    expect(r.iou).toEqual({ beforePaise: "100000", afterPaise: "-20000" });
    expect(await net(p)).toBe(-20000n);
    expect((await getTransaction(h.db, owner, r.id)).type).toBe("repayment_received"); // type unchanged
  });

  it("supports a signed opening IOU and rejects entries before its date", async () => {
    const p = (await createPerson(h.db, owner, { name: "Esha", openingIou: "-750.50", openingDate: D(10) })).id;
    expect(await net(p)).toBe(-75050n);
    await expectErr(add({ type: "lend", amount: "100", personId: p, date: D(11) }), "validation");
    await expectErr(updatePerson(h.db, owner, { id: p, version: 1, name: "Esha", openingIou: "0", openingDate: D(10) }), "needs_confirmation");
    await updatePerson(h.db, owner, { id: p, version: 1, name: "Esha", openingIou: "0", openingDate: D(10), confirmOpeningChange: true });
    expect(await net(p)).toBe(0n);
    expect(await incomeExpense(h.db, owner.ownerId, allCycle())).toEqual({ incomePaise: "0", expensePaise: "0" });
  });
});

describe("5-6. accounts, transfers, income and expense", () => {
  it("5. transfer moves money between accounts only", async () => {
    const before = (await getOverview(h.db, owner)).accountTotalPaise;
    await add({ type: "transfer", amount: "1000", accountId: bank, toAccountId: cash });
    expect(await bal(bank)).toBe(4900000n);
    expect(await bal(cash)).toBe(100000n);
    const ov = await getOverview(h.db, owner);
    expect(ov.accountTotalPaise).toBe(before);
    expect(await incomeExpense(h.db, owner.ownerId, allCycle())).toEqual({ incomePaise: "0", expensePaise: "0" });
    expect(ov.budget.spentPaise).toBe("0");
    await expectErr(add({ type: "transfer", amount: "1000", accountId: bank, toAccountId: bank }), "validation");
    await expectErr(add({ type: "transfer", amount: "1000", accountId: bank }), "validation");
  });

  it("6. expense, income and opening balance effects", async () => {
    await add({ type: "expense", amount: "250", categoryId: food, date: TODAY });
    expect(await bal(bank)).toBe(5000000n - 25000n);
    const cycle = cycleFor(TODAY, 1);
    const bv = await getBudgetView(h.db, owner, cycle);
    expect(bv.spentPaise).toBe("25000");
    expect(bv.categories.find((c) => c.categoryId === food)!.spentPaise).toBe("25000");

    await add({ type: "income", amount: "10000", categoryId: salary, date: TODAY });
    expect(await bal(bank)).toBe(5000000n - 25000n + 1000000n);
    const ie = await incomeExpense(h.db, owner.ownerId, cycle);
    expect(ie).toEqual({ incomePaise: "1000000", expensePaise: "25000" });

    // Opening balances are neither income nor spending.
    const fresh = (await createAccount(h.db, owner, { name: "Savings", kind: "bank", openingBalance: "99999", openingDate: TODAY })).id;
    expect(await bal(fresh)).toBe(9999900n);
    expect(await incomeExpense(h.db, owner.ownerId, cycle)).toEqual(ie);
  });

  it("validates category kind, archived refs and opening dates", async () => {
    await expectErr(add({ type: "expense", amount: "10", categoryId: salary }), "validation");
    await expectErr(add({ type: "expense", amount: "10" }), "validation");
    await expectErr(add({ type: "lend", amount: "10" }), "validation");
    await expectErr(add({ type: "expense", amount: "10", categoryId: food, date: addDays(OPEN, -1) }), "validation");
    // Opening-balance change needs explicit confirmation, then is audited (not a transaction).
    const a = await getAccount(h.db, owner, bank);
    await expectErr(updateAccount(h.db, owner, { id: bank, version: a.version, name: a.name, kind: "bank", openingBalance: "100", openingDate: OPEN }), "needs_confirmation");
    await updateAccount(h.db, owner, { id: bank, version: a.version, name: a.name, kind: "bank", openingBalance: "100", openingDate: OPEN, confirmOpeningChange: true });
    expect(await bal(bank)).toBe(10000n);
    expect((await listTransactions(h.db, owner, {})).items).toHaveLength(0);
  });

  it("shows negative balances rather than blocking", async () => {
    await add({ type: "expense", amount: "100", categoryId: food, accountId: cash });
    expect(await bal(cash)).toBe(-10000n);
  });

  it("rejects future-dated entries", async () => {
    await expectErr(add({ type: "expense", amount: "10", categoryId: food, date: addDays(TODAY, 1) }), "validation");
  });
});

describe("7. amounts at the boundary", () => {
  it("stores exact paise and enforces the maximum", async () => {
    await add({ type: "income", amount: "0.10", categoryId: salary });
    await add({ type: "income", amount: "0.20", categoryId: salary });
    expect((await incomeExpense(h.db, owner.ownerId, allCycle())).incomePaise).toBe("30");
    await add({ type: "income", amount: "10000000000", categoryId: salary });
    for (const bad of ["10000000000.01", "1.001", "", "0", "-5", "1e3", "NaN"]) {
      await expectErr(add({ type: "income", amount: bad, categoryId: salary }), "validation");
    }
    const list = await listTransactions(h.db, owner, {});
    expect(JSON.parse(JSON.stringify(list)).items[0].amountPaise).toBe("1000000000000");
  });
});

describe("8. edits and deletes recalculate; stale edits are rejected", () => {
  it("updates all derived totals", async () => {
    const p = (await createPerson(h.db, owner, { name: "Farah", openingIou: "0", openingDate: OPEN })).id;
    const loan = await add({ type: "lend", amount: "1000", personId: p });
    const exp = await add({ type: "expense", amount: "300", categoryId: food });
    const tr = await add({ type: "transfer", amount: "200", toAccountId: cash });
    expect(await bal(bank)).toBe(5000000n - 100000n - 30000n - 20000n);

    await updateTransaction(h.db, owner, { id: loan.id, version: 1, type: "lend", amount: "1500", date: D(1), accountId: bank, personId: p });
    expect(await net(p)).toBe(150000n);
    await updateTransaction(h.db, owner, { id: exp.id, version: 1, type: "expense", amount: "50", date: D(1), accountId: cash, categoryId: food });
    await updateTransaction(h.db, owner, { id: tr.id, version: 1, type: "transfer", amount: "200", date: D(1), accountId: cash, toAccountId: bank });
    expect(await bal(bank)).toBe(5000000n - 150000n + 20000n);
    expect(await bal(cash)).toBe(-5000n - 20000n);
    expect((await incomeExpense(h.db, owner.ownerId, allCycle())).expensePaise).toBe("5000");

    const rep = await add({ type: "repayment_received", amount: "500", personId: p });
    await deleteTransaction(h.db, owner, { id: rep.id, version: 1 });
    expect(await net(p)).toBe(150000n);
    await deleteTransaction(h.db, owner, { id: tr.id, version: 2 });
    expect(await bal(cash)).toBe(-5000n);

    // Stale: two tabs edit version 2 of the loan.
    await updateTransaction(h.db, owner, { id: loan.id, version: 2, type: "lend", amount: "1600", date: D(1), accountId: bank, personId: p });
    const e = await expectErr(
      updateTransaction(h.db, owner, { id: loan.id, version: 2, type: "lend", amount: "9999", date: D(1), accountId: bank, personId: p }),
      "stale",
    );
    expect(e.message).toMatch(/Reload/);
    await expectErr(deleteTransaction(h.db, owner, { id: loan.id, version: 2 }), "stale");
    expect(await net(p)).toBe(160000n);
  });
});

describe("9. idempotency and concurrency", () => {
  it("duplicate submissions create one entry", async () => {
    const key = idem();
    const a = await add({ type: "expense", amount: "99", categoryId: food, idempotencyKey: key });
    const b = await add({ type: "expense", amount: "99", categoryId: food, idempotencyKey: key });
    expect(b).toMatchObject({ id: a.id, duplicate: true });
    const parallel = await Promise.all(
      Array.from({ length: 8 }, () => add({ type: "expense", amount: "10", categoryId: food, idempotencyKey: "same-key-parallel" })),
    );
    expect(new Set(parallel.map((r) => r.id)).size).toBe(1);
    expect((await listTransactions(h.db, owner, {})).items).toHaveLength(2);
  });

  it("concurrent valid writes do not lose money or half-write transfers", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        i % 2 ? add({ type: "transfer", amount: "10", toAccountId: cash }) : add({ type: "expense", amount: "1", categoryId: food, accountId: cash }),
      ),
    );
    expect(await bal(cash)).toBe(10n * 1000n - 10n * 100n);
    expect(await bal(bank)).toBe(5000000n - 10000n);
    const ov = await getOverview(h.db, owner);
    expect(BigInt(ov.accountTotalPaise)).toBe(5000000n - 1000n);
  });

  it("concurrent repayments are serialised for the cross-zero check", async () => {
    const p = (await createPerson(h.db, owner, { name: "Gita", openingIou: "100", openingDate: OPEN })).id;
    const results = await Promise.allSettled(
      [1, 2, 3].map(() => add({ type: "repayment_received", amount: "100", personId: p })),
    );
    // Only one can settle exactly; the others would cross zero and need confirmation.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await net(p)).toBe(0n);
  });
});

describe("10. budget cycles and historical budgets", () => {
  it("cycles follow the salary day; past budgets are never rewritten", async () => {
    await updateSettings(h.db, owner, { timezone: "Asia/Kolkata", cycleStartDay: 31, theme: "system" });
    const cur = cycleFor(TODAY, 31);
    const prev = cycleFor(addDays(cur.start, -1), 31);
    await setBudget(h.db, owner, { periodStart: prev.start, overall: "5000", categoryLimits: [{ categoryId: food, limit: "1000" }] });
    await setBudget(h.db, owner, { periodStart: cur.start, overall: "8000", categoryLimits: [] });
    const pv = await getBudgetView(h.db, owner, prev);
    expect(pv.overallLimitPaise).toBe("500000");
    expect(pv.categories.find((c) => c.categoryId === food)!.limitPaise).toBe("100000");
    const cv = await getBudgetView(h.db, owner, cur);
    expect(cv.overallLimitPaise).toBe("800000");
    expect(cv.categories.find((c) => c.categoryId === food)!.limitPaise).toBeNull(); // Not set, no carry-forward
    await expectErr(setBudget(h.db, owner, { periodStart: addDays(cur.start, 1), overall: "1", categoryLimits: [] }), "validation");
    await expectErr(setBudget(h.db, owner, { periodStart: cur.start, overall: "1", categoryLimits: [{ categoryId: salary, limit: "5" }] }), "validation");
  });

  it("date-range edges are inclusive at start and exclusive at end", async () => {
    const c = cycleFor(TODAY, 1);
    if (c.start !== TODAY) await add({ type: "expense", amount: "1", categoryId: food, date: c.start });
    await add({ type: "expense", amount: "2", categoryId: food, date: addDays(c.start, -1) });
    const bv = await getBudgetView(h.db, owner, c);
    expect(bv.spentPaise).toBe(c.start !== TODAY ? "100" : "0");
    const list = await listTransactions(h.db, owner, { from: addDays(c.start, -1), to: addDays(c.start, -1) });
    expect(list.items).toHaveLength(1);
  });
});

describe("11. people are separate even with the same name", () => {
  it("does not merge or net different people", async () => {
    const a = (await createPerson(h.db, owner, { name: "Ravi", label: "college", openingIou: "0", openingDate: OPEN })).id;
    const b = (await createPerson(h.db, owner, { name: "Ravi", label: "office", openingIou: "0", openingDate: OPEN })).id;
    await add({ type: "lend", amount: "700", personId: a });
    await add({ type: "borrow", amount: "300", personId: b });
    expect(await getIouTotals(h.db, owner)).toEqual({ owedToMe: 70000n, iOwe: 30000n });
    const ov = await getOverview(h.db, owner);
    expect([ov.owedToMePaise, ov.iOwePaise]).toEqual(["70000", "30000"]);
    expect((await getPersonDetail(h.db, owner, a)).history).toHaveLength(1);
  });
});

describe("pagination and search", () => {
  it("pages through all entries without gaps or duplicates", async () => {
    for (let i = 0; i < 75; i++) await add({ type: "expense", amount: String(i + 1), categoryId: food, date: D(i % 5), note: i === 7 ? "Chai 100% _special_" : undefined });
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await listTransactions(h.db, owner, { cursor });
      page.items.forEach((t) => seen.add(t.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen.size).toBe(75);
    expect((await listTransactions(h.db, owner, { q: "100%" })).items).toHaveLength(1);
    expect((await listTransactions(h.db, owner, { q: "%" })).items).toHaveLength(1); // wildcard escaped
    expect((await listTransactions(h.db, owner, { q: "' OR 1=1 --" })).items).toHaveLength(0);
  });
});

describe("database constraints back up the service layer", () => {
  it("rejects illegal shapes and amounts directly in SQL", async () => {
    const ins = (frag: ReturnType<typeof sql>) => h.db.execute(frag);
    await expect(ins(sql`INSERT INTO transactions (owner_id, type, amount_paise, txn_date, account_id, idempotency_key)
      VALUES (${owner.ownerId}, 'expense', 0, ${TODAY}, ${bank}, 'raw-test-1')`)).rejects.toThrow();
    await expect(ins(sql`INSERT INTO transactions (owner_id, type, amount_paise, txn_date, account_id, to_account_id, idempotency_key)
      VALUES (${owner.ownerId}, 'transfer', 100, ${TODAY}, ${bank}, ${bank}, 'raw-test-2')`)).rejects.toThrow();
    await expect(ins(sql`INSERT INTO transactions (owner_id, type, amount_paise, txn_date, account_id, category_id, idempotency_key)
      VALUES (${owner.ownerId}, 'expense', 100, ${TODAY}, ${bank}, ${salary}, 'raw-test-3')`)).rejects.toThrow();
    await expect(ins(sql`INSERT INTO app_owner (id, user_id) VALUES (2, ${owner.ownerId})`)).rejects.toThrow();
  });

  it("runtime role cannot change the schema", async () => {
    await expect(h.db.execute(sql`CREATE TABLE should_fail (id int)`)).rejects.toThrow();
    await expect(h.db.execute(sql`DROP TABLE transactions`)).rejects.toThrow();
    await expect(h.db.execute(sql`TRUNCATE transactions`)).rejects.toThrow();
  });

  it("lists accounts with derived balances only", async () => {
    const list = await listAccounts(h.db, owner);
    expect(list.map((a) => a.balancePaise)).toEqual(["5000000", "0"]);
  });
});
