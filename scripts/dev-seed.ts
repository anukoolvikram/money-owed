// DEVELOPMENT ONLY: adds fictional example data for the existing local owner.
// Refuses to run in production or against any non-local database.
import { sql } from "drizzle-orm";
import { loadEnvFile, requireVar } from "./lib/env";
import { adminDeps } from "./lib/admin-deps";
import { resolveOwner } from "../src/server/auth/owner";
import { createAccount } from "../src/server/services/accounts";
import { createPerson } from "../src/server/services/people";
import { createTransaction } from "../src/server/services/transactions";
import { listCategories } from "../src/server/services/categories";
import { setBudget } from "../src/server/services/budgets";
import { addDays, cycleFor, todayIn } from "../src/lib/dates";

async function main() {
  loadEnvFile();
  const host = new URL(requireVar("DATABASE_URL")).hostname;
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(host)) {
    console.error("Refusing: dev-seed only runs against a local development database.");
    process.exit(1);
  }
  const deps = adminDeps();
  try {
    const r = await deps.db.execute<{ user_id: string }>(sql`SELECT user_id FROM app_owner WHERE id = 1`);
    if (!r.rows[0]) throw new Error("Sign in once first: the owner is created from ADMIN_USERNAME / ADMIN_PASSWORD on first sign-in.");
    const owner = (await resolveOwner(deps.db, r.rows[0].user_id, "seed"))!;
    const has = await deps.db.execute(sql`SELECT 1 FROM accounts WHERE owner_id = ${owner.ownerId} LIMIT 1`);
    if (has.rows.length) throw new Error("Ledger already has data; not seeding again.");
    const today = todayIn("Asia/Kolkata");
    const D = (n: number) => addDays(today, -n);
    const bank = (await createAccount(deps.db, owner, { name: "Example Bank", kind: "bank", openingBalance: "42000", openingDate: D(60) })).id;
    const cash = (await createAccount(deps.db, owner, { name: "Cash", kind: "cash", openingBalance: "1500", openingDate: D(60) })).id;
    const cats = await listCategories(deps.db, owner);
    const c = (n: string) => cats.find((x) => x.name === n)!.id;
    const asha = (await createPerson(deps.db, owner, { name: "Asha (example)", openingIou: "0", openingDate: D(60) })).id;
    const bala = (await createPerson(deps.db, owner, { name: "Bala (example)", label: "office", openingIou: "-300", openingDate: D(60) })).id;
    let k = 0;
    const add = (f: Record<string, unknown>) => createTransaction(deps.db, owner, { accountId: bank, idempotencyKey: `seed-${Date.now()}-${k++}`, ...f });
    await add({ type: "income", amount: "65000", categoryId: c("Salary"), date: D(20) });
    for (let i = 0; i < 18; i++) await add({ type: "expense", amount: String(80 + ((i * 137) % 900)), categoryId: c(["Food", "Groceries", "Transport", "Bills", "Shopping"][i % 5]), date: D(i), paymentMethod: "upi", note: i % 4 === 0 ? "example note" : undefined });
    await add({ type: "transfer", amount: "2000", toAccountId: cash, date: D(10) });
    await add({ type: "expense", amount: "350", accountId: cash, categoryId: c("Food"), date: D(3), paymentMethod: "cash" });
    await add({ type: "lend", amount: "5000", personId: asha, date: D(25) });
    await add({ type: "lend", amount: "2000", personId: asha, date: D(15) });
    await add({ type: "repayment_received", amount: "1500", personId: asha, date: D(5) });
    await add({ type: "borrow", amount: "1000", personId: bala, date: D(8) });
    const cyc = cycleFor(today, 1);
    await setBudget(deps.db, owner, { periodStart: cyc.start, overall: "30000", categoryLimits: [{ categoryId: c("Food"), limit: "4000" }, { categoryId: c("Shopping"), limit: "1500" }] });
    console.log("Fictional development data added.");
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    await deps.pool.end();
  }
}
main();
