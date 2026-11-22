import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { budgetCategoryLimits, budgetPeriods } from "../db/schema";
import type { DB } from "../db/client";
import type { OwnerContext } from "../auth/owner";
import type { Exec } from "./ledger-sql";
import { localDate, uuid } from "./validators";
import { validation } from "./errors";
import { parseOrThrow } from "./util";
import { getSettings } from "./settings";
import { cycleFor, type Cycle } from "@/lib/dates";
import { parseRupees } from "@/lib/money";

export type BudgetView = {
  cycle: Cycle;
  overallLimitPaise: string | null; // null => "Not set"
  spentPaise: string;
  categories: { categoryId: string; name: string; archived: boolean; limitPaise: string | null; spentPaise: string }[];
};

/** Spending (expense type only) for a cycle, overall and per category. */
export async function getBudgetView(db: Exec, owner: OwnerContext, cycle: Cycle): Promise<BudgetView> {
  const periodRes = await db
    .select()
    .from(budgetPeriods)
    .where(and(eq(budgetPeriods.ownerId, owner.ownerId), eq(budgetPeriods.periodStart, cycle.start)));
  const period = periodRes[0];

  const spend = await db.execute<{ category_id: string; name: string; archived: boolean; spent: string; limit_paise: string | null }>(sql`
    SELECT c.id AS category_id, c.name, (c.archived_at IS NOT NULL) AS archived,
      COALESCE(s.spent, 0)::text AS spent, l.limit_paise::text AS limit_paise
    FROM categories c
    LEFT JOIN (
      SELECT category_id, SUM(amount_paise) AS spent FROM transactions
      WHERE owner_id = ${owner.ownerId} AND type = 'expense' AND txn_date >= ${cycle.start} AND txn_date < ${cycle.end}
      GROUP BY category_id
    ) s ON s.category_id = c.id
    LEFT JOIN budget_category_limits l ON l.owner_id = c.owner_id AND l.category_id = c.id
      AND l.budget_period_id = ${period?.id ?? null}
    WHERE c.owner_id = ${owner.ownerId} AND c.kind = 'expense'
      AND (c.archived_at IS NULL OR s.spent IS NOT NULL OR l.limit_paise IS NOT NULL)
    ORDER BY COALESCE(s.spent, 0) DESC, lower(c.name)`);

  let total = 0n;
  for (const r of spend.rows) total += BigInt(r.spent);
  return {
    cycle,
    overallLimitPaise: period?.overallLimitPaise?.toString() ?? null,
    spentPaise: total.toString(),
    categories: spend.rows.map((r) => ({
      categoryId: r.category_id,
      name: r.name,
      archived: r.archived,
      limitPaise: r.limit_paise,
      spentPaise: r.spent,
    })),
  };
}

const optionalLimit = z.string().transform((v, ctx) => {
  if (v.trim() === "") return null;
  const r = parseRupees(v);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", message: r.error });
    return z.NEVER;
  }
  return r.paise;
});

const setBudgetSchema = z.object({
  periodStart: localDate,
  overall: optionalLimit,
  categoryLimits: z.array(z.object({ categoryId: uuid, limit: optionalLimit })).max(200),
});

/**
 * Sets the budget for ONE cycle. Each cycle has its own row, so editing this or a
 * future cycle never rewrites earlier months. There is no automatic carry-forward.
 */
export async function setBudget(db: DB, owner: OwnerContext, raw: unknown): Promise<void> {
  const input = parseOrThrow(setBudgetSchema, raw);
  const settings = await getSettings(db, owner);
  const cycle = cycleFor(input.periodStart, settings.cycleStartDay);
  if (cycle.start !== input.periodStart) throw validation("That date is not the start of a budget cycle.");

  await db.transaction(async (tx) => {
    const ids = input.categoryLimits.map((c) => c.categoryId);
    if (ids.length) {
      const ok = await tx.execute<{ id: string }>(sql`
        SELECT id FROM categories WHERE owner_id = ${owner.ownerId} AND kind = 'expense'
        AND id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
      if (ok.rows.length !== new Set(ids).size) throw validation("One of the categories is not a valid expense category.");
    }
    const [period] = await tx
      .insert(budgetPeriods)
      .values({ ownerId: owner.ownerId, periodStart: cycle.start, periodEnd: cycle.end, overallLimitPaise: input.overall })
      .onConflictDoUpdate({
        target: [budgetPeriods.ownerId, budgetPeriods.periodStart],
        set: { overallLimitPaise: input.overall, updatedAt: new Date() },
      })
      .returning({ id: budgetPeriods.id });
    for (const cl of input.categoryLimits) {
      if (cl.limit === null) {
        await tx
          .delete(budgetCategoryLimits)
          .where(and(eq(budgetCategoryLimits.ownerId, owner.ownerId), eq(budgetCategoryLimits.budgetPeriodId, period.id), eq(budgetCategoryLimits.categoryId, cl.categoryId)));
      } else {
        await tx
          .insert(budgetCategoryLimits)
          .values({ ownerId: owner.ownerId, budgetPeriodId: period.id, categoryId: cl.categoryId, limitPaise: cl.limit })
          .onConflictDoUpdate({
            target: [budgetCategoryLimits.ownerId, budgetCategoryLimits.budgetPeriodId, budgetCategoryLimits.categoryId],
            set: { limitPaise: cl.limit, updatedAt: new Date() },
          });
      }
    }
  });
}

export { budgetStatus } from "@/lib/budget";
