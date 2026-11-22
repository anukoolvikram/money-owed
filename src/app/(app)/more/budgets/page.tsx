import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { getBudgetView } from "@/server/services/budgets";
import { getSettings } from "@/server/services/settings";
import { Card, Main, PageHeader, SectionTitle } from "@/components/ui";
import { BudgetBar } from "@/components/budget-bar";
import { BudgetForm } from "@/components/budget-form";
import { cycleFor, formatCycle, isValidLocalDate, nextCycle, previousCycle, todayIn } from "@/lib/dates";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const owner = await requireOwnerPage();
  const sp = await searchParams;
  const settings = await getSettings(db(), owner);
  const today = todayIn(settings.timezone);
  const cycle = cycleFor(isValidLocalDate(sp.period) ? sp.period : today, settings.cycleStartDay);
  const view = await getBudgetView(db(), owner, cycle);
  const prev = previousCycle(cycle, settings.cycleStartDay);
  const next = nextCycle(cycle, settings.cycleStartDay);
  const isCurrent = today >= cycle.start && today < cycle.end;
  return (
    <>
      <PageHeader title="Budgets" back="/more" subtitle={formatCycle(cycle) + (isCurrent ? " (current)" : "")} />
      <Main>
        <nav aria-label="Budget cycle" className="mb-3 flex justify-between text-sm">
          <Link className="inline-flex min-h-11 items-center px-2 text-accent" href={`/more/budgets?period=${prev.start}`}>‹ Previous</Link>
          {!isCurrent && <Link className="inline-flex min-h-11 items-center px-2 text-accent" href="/more/budgets">Current</Link>}
          <Link className="inline-flex min-h-11 items-center px-2 text-accent" href={`/more/budgets?period=${next.start}`}>Next ›</Link>
        </nav>
        <Card>
          <BudgetBar spent={BigInt(view.spentPaise)} limit={view.overallLimitPaise ? BigInt(view.overallLimitPaise) : null} label="Overall" />
          <ul className="mt-4 space-y-3">
            {view.categories.map((c) => (
              <li key={c.categoryId}>
                <BudgetBar spent={BigInt(c.spentPaise)} limit={c.limitPaise ? BigInt(c.limitPaise) : null} label={c.name} />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">Only expenses count. Transfers, loans and repayments never use your budget. Budgets are per cycle and are not copied forward automatically. Warnings show here in the app only; there are no phone notifications.</p>
        </Card>
        <SectionTitle>Set limits for this cycle</SectionTitle>
        <Card>
          <BudgetForm key={cycle.start} periodStart={cycle.start} overall={view.overallLimitPaise}
            categories={view.categories.filter((c) => !c.archived).map((c) => ({ categoryId: c.categoryId, name: c.name, limitPaise: c.limitPaise }))} />
        </Card>
        <p className="mt-3 text-sm text-muted">Cycle starts on day {settings.cycleStartDay} of each month. <Link href="/more/settings" className="text-accent underline">Change</Link></p>
      </Main>
    </>
  );
}
