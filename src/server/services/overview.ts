import { sql } from "drizzle-orm";
import type { OwnerContext } from "../auth/owner";
import { iouTotals, personNets, type Exec } from "./ledger-sql";
import { listAccounts } from "./accounts";
import { getBudgetView } from "./budgets";
import { listTransactions } from "./transactions";
import { getSettings } from "./settings";
import { addDays, cycleFor, todayIn, type Cycle } from "@/lib/dates";

/** Earned income and spending for a period. Transfers and IOUs are excluded by type. */
export async function incomeExpense(db: Exec, ownerId: string, cycle: Cycle) {
  const res = await db.execute<{ income: string; expense: string }>(sql`
    SELECT COALESCE(SUM(amount_paise) FILTER (WHERE type = 'income'), 0)::text AS income,
           COALESCE(SUM(amount_paise) FILTER (WHERE type = 'expense'), 0)::text AS expense
    FROM transactions WHERE owner_id = ${ownerId} AND txn_date >= ${cycle.start} AND txn_date < ${cycle.end}`);
  return { incomePaise: res.rows[0].income, expensePaise: res.rows[0].expense };
}

/** Cash moved in/out through IOUs this cycle (shown separately from income/spending). */
export async function iouCashFlow(db: Exec, ownerId: string, cycle: Cycle) {
  const res = await db.execute<{ cash_in: string; cash_out: string }>(sql`
    SELECT COALESCE(SUM(amount_paise) FILTER (WHERE type IN ('borrow','repayment_received')), 0)::text AS cash_in,
           COALESCE(SUM(amount_paise) FILTER (WHERE type IN ('lend','repayment_paid')), 0)::text AS cash_out
    FROM transactions WHERE owner_id = ${ownerId} AND txn_date >= ${cycle.start} AND txn_date < ${cycle.end}`);
  return { iouInPaise: res.rows[0].cash_in, iouOutPaise: res.rows[0].cash_out };
}

export async function dailySpending(db: Exec, ownerId: string, cycle: Cycle) {
  const res = await db.execute<{ d: string; spent: string }>(sql`
    SELECT txn_date::text AS d, SUM(amount_paise)::text AS spent FROM transactions
    WHERE owner_id = ${ownerId} AND type = 'expense' AND txn_date >= ${cycle.start} AND txn_date < ${cycle.end}
    GROUP BY txn_date ORDER BY txn_date`);
  const map = new Map(res.rows.map((r) => [r.d, r.spent]));
  const out: { date: string; spentPaise: string }[] = [];
  for (let d = cycle.start; d < cycle.end; d = addDays(d, 1)) out.push({ date: d, spentPaise: map.get(d) ?? "0" });
  return out;
}

export async function getOverview(db: Exec, owner: OwnerContext, periodStart?: string) {
  const settings = await getSettings(db, owner);
  const today = todayIn(settings.timezone);
  const cycle = cycleFor(periodStart ?? today, settings.cycleStartDay);
  const [ie, iouFlow, accts, nets, budget, recent, daily] = await Promise.all([
    incomeExpense(db, owner.ownerId, cycle),
    iouCashFlow(db, owner.ownerId, cycle),
    listAccounts(db, owner, { includeArchived: true }),
    personNets(db, owner.ownerId),
    getBudgetView(db, owner, cycle),
    listTransactions(db, owner, {}, 6),
    dailySpending(db, owner.ownerId, cycle),
  ]);
  const totals = iouTotals(nets.values());
  let accountTotal = 0n;
  for (const a of accts) accountTotal += BigInt(a.balancePaise);
  return {
    today,
    cycle,
    settings,
    ...ie,
    ...iouFlow,
    accountTotalPaise: accountTotal.toString(),
    accounts: accts.filter((a) => !a.archived || a.balancePaise !== "0"),
    owedToMePaise: totals.owedToMe.toString(),
    iOwePaise: totals.iOwe.toString(),
    budget,
    recent: recent.items,
    daily: daily.filter((d) => d.date <= today),
  };
}
