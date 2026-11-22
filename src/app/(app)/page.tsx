import Link from "next/link";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { getOverview } from "@/server/services/overview";
import { budgetStatus } from "@/lib/budget";
import { Card, EmptyState, LinkButton, Main, Money, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { TxnRow } from "@/components/txn-row";
import { SpendingChart } from "@/components/spending-chart";
import { BudgetBar } from "@/components/budget-bar";
import { formatCycle, isValidLocalDate, nextCycle, previousCycle } from "@/lib/dates";
import { formatINR } from "@/lib/money";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const owner = await requireOwnerPage();
  const sp = await searchParams;
  const ov = await getOverview(db(), owner, isValidLocalDate(sp.period) ? sp.period : undefined);
  const day = ov.settings.cycleStartDay;
  const prev = previousCycle(ov.cycle, day);
  const next = nextCycle(ov.cycle, day);
  const isCurrent = ov.today >= ov.cycle.start && ov.today < ov.cycle.end;
  const spent = BigInt(ov.expensePaise);
  const limit = ov.budget.overallLimitPaise ? BigInt(ov.budget.overallLimitPaise) : null;
  const status = budgetStatus(spent, limit);
  const topCats = ov.budget.categories.filter((c) => c.spentPaise !== "0").slice(0, 6);
  const maxCat = topCats.reduce((m, c) => (BigInt(c.spentPaise) > m ? BigInt(c.spentPaise) : m), 0n);
  const negative = ov.accounts.filter((a) => BigInt(a.balancePaise) < 0n);
  const hasSpending = ov.daily.some((d) => d.spentPaise !== "0");

  return (
    <>
      <PageHeader title="Overview" subtitle={formatCycle(ov.cycle)} action={<LinkButton href="/add" className="hidden sm:inline-flex">Add</LinkButton>} />
      <Main>
        <nav aria-label="Budget period" className="mb-3 flex items-center justify-between text-sm">
          <Link className="inline-flex min-h-11 items-center px-2 text-accent" href={`/?period=${prev.start}`}>‹ Previous</Link>
          {!isCurrent && <Link className="inline-flex min-h-11 items-center px-2 text-accent" href="/">Current period</Link>}
          {next.start <= ov.today ? (
            <Link className="inline-flex min-h-11 items-center px-2 text-accent" href={`/?period=${next.start}`}>Next ›</Link>
          ) : (
            <span className="px-2 text-muted" aria-hidden>Next ›</span>
          )}
        </nav>

        <Card>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted">Spent</p>
              <Money paise={ov.expensePaise} className="text-2xl font-semibold" />
            </div>
            <div>
              <p className="text-sm text-muted">Earned income</p>
              <Money paise={ov.incomePaise} className="text-2xl font-semibold" />
            </div>
          </div>
          <div className="mt-4">
            {status.state === "not_set" ? (
              <p className="text-sm text-muted">
                Budget: <span className="font-medium text-ink">Not set</span> ·{" "}
                <Link href={`/more/budgets?period=${ov.cycle.start}`} className="text-accent underline">Set a budget</Link>
              </p>
            ) : (
              <BudgetBar spent={spent} limit={limit!} label="Overall budget" />
            )}
          </div>
        </Card>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <p className="text-sm text-muted">In my accounts</p>
            <Money paise={ov.accountTotalPaise} className="text-xl font-semibold" />
            <p className="mt-1 text-xs text-muted">Cash, bank and wallets. Not net worth.</p>
          </Card>
          <Card>
            <p className="text-sm text-muted">Owed to me</p>
            <Money paise={ov.owedToMePaise} className="text-xl font-semibold" />
          </Card>
          <Card>
            <p className="text-sm text-muted">I owe</p>
            <Money paise={ov.iOwePaise} className="text-xl font-semibold" />
          </Card>
        </div>

        {negative.length > 0 && (
          <div className="mt-3">
            <Notice tone="warn" title="Negative balance">
              {negative.map((a) => `${a.name}: ${formatINR(BigInt(a.balancePaise))}`).join(", ")}. Check for a missing income, transfer or a wrong account.
            </Notice>
          </div>
        )}

        {(ov.iouInPaise !== "0" || ov.iouOutPaise !== "0") && (
          <p className="mt-3 px-1 text-sm text-muted">
            Lending &amp; borrowing this period (not income or spending): in <Money paise={ov.iouInPaise} />, out <Money paise={ov.iouOutPaise} />.
          </p>
        )}

        {ov.accounts.length === 0 ? (
          <div className="mt-6">
            <EmptyState title="Start by adding an account" action={<LinkButton href="/more/accounts">Add account</LinkButton>}>
              Create your cash, bank or wallet accounts with their current balance.
            </EmptyState>
          </div>
        ) : (
          <>
            <SectionTitle>Spending by day</SectionTitle>
            <Card>
              {hasSpending ? <SpendingChart data={ov.daily} /> : <p className="text-sm text-muted">No spending recorded in this period.</p>}
            </Card>

            <SectionTitle action={<Link href={`/more/budgets?period=${ov.cycle.start}`} className="inline-flex min-h-11 items-center text-sm text-accent">Budgets</Link>}>
              By category
            </SectionTitle>
            <Card>
              {topCats.length === 0 ? (
                <p className="text-sm text-muted">No spending recorded in this period.</p>
              ) : (
                <ul className="space-y-3">
                  {topCats.map((c) => {
                    const v = BigInt(c.spentPaise);
                    const pct = maxCat > 0n ? Number((v * 1000n) / maxCat) / 10 : 0;
                    return (
                      <li key={c.categoryId}>
                        <div className="flex justify-between gap-2 text-sm">
                          <span className="truncate">{c.name}</span>
                          <Money paise={c.spentPaise} />
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden>
                          <div className="h-2 rounded-full bg-[var(--chart)]" style={{ width: `${Math.max(pct, 2)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </>
        )}

        <SectionTitle action={<Link href="/transactions" className="inline-flex min-h-11 items-center text-sm text-accent">See all</Link>}>Recent</SectionTitle>
        {ov.recent.length === 0 ? (
          <EmptyState title="No entries yet" action={<LinkButton href="/add">Add your first entry</LinkButton>} />
        ) : (
          <Card className="p-2">
            <ul className="divide-y divide-line">{ov.recent.map((t) => <TxnRow key={t.id} t={t} />)}</ul>
          </Card>
        )}
      </Main>
    </>
  );
}
