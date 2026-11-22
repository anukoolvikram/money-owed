import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { listPeople, type PeopleFilter } from "@/server/services/people";
import { iouTotals } from "@/server/services/ledger-sql";
import { ownerToday } from "@/server/services/settings";
import { Badge, Card, cx, EmptyState, Main, Money, PageHeader } from "@/components/ui";
import { AddPersonPanel } from "./add-person";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const metadata: Metadata = { title: "People" };

const FILTERS: { key: PeopleFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "owes_me", label: "Owe me" },
  { key: "i_owe", label: "I owe" },
  { key: "settled", label: "Settled" },
];

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; archived?: string; new?: string }> }) {
  const owner = await requireOwnerPage();
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.filter)?.key ?? "all") as PeopleFilter;
  const showArchived = sp.archived === "1";
  const [all, list, today] = await Promise.all([
    listPeople(db(), owner),
    listPeople(db(), owner, { filter, q: sp.q?.slice(0, 60), includeArchived: showArchived }),
    ownerToday(db(), owner),
  ]);
  const totals = iouTotals(all.map((p) => BigInt(p.netPaise)));
  const qs = (f: string) => `/people?${new URLSearchParams({ ...(f !== "all" ? { filter: f } : {}), ...(sp.q ? { q: sp.q } : {}), ...(showArchived ? { archived: "1" } : {}) })}`;

  return (
    <>
      <PageHeader title="People & IOUs" />
      <Main>
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-sm text-muted">Owed to me</p>
            <Money paise={totals.owedToMe} className="text-xl font-semibold" />
          </Card>
          <Card>
            <p className="text-sm text-muted">I owe</p>
            <Money paise={totals.iOwe} className="text-xl font-semibold" />
          </Card>
        </div>

        <nav aria-label="Filter people" className="mt-4 flex gap-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <Link key={f.key} href={qs(f.key)} aria-current={filter === f.key ? "page" : undefined}
              className={cx("inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-[15px]", filter === f.key ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface")}>
              {f.label}
            </Link>
          ))}
        </nav>
        <form method="get" className="mt-3 flex gap-2" role="search">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <label htmlFor="pq" className="sr-only">Search people</label>
          <input id="pq" name="q" type="search" defaultValue={sp.q} placeholder="Search people" className="min-h-11 flex-1 rounded-xl border border-line bg-surface px-3" />
          <button className="min-h-11 rounded-xl border border-line px-4">Search</button>
        </form>

        <div className="mt-4">
          <AddPersonPanel today={today} startOpen={sp.new === "1" || all.length === 0} />
        </div>

        <div className="mt-4">
          {list.length === 0 ? (
            <EmptyState title={all.length ? "Nobody matches" : "No people yet"}>Add someone you lend to or borrow from.</EmptyState>
          ) : (
            <Card className="p-2">
              <ul className="divide-y divide-line">
                {list.map((p) => {
                  const n = BigInt(p.netPaise);
                  return (
                    <li key={p.id}>
                      <Link href={`/people/${p.id}`} className="flex min-h-16 items-center justify-between gap-3 px-2 py-2 hover:bg-surface-2">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {p.name} {p.label && <span className="font-normal text-muted">({p.label})</span>} {p.archived && <Badge>Archived</Badge>}
                          </span>
                          <span className="block text-sm text-muted">{p.lastEntryDate ? `Last entry ${formatDate(p.lastEntryDate)}` : "No entries yet"}</span>
                        </span>
                        <span className="shrink-0 text-right text-sm">
                          {n > 0n ? <><span className="block text-muted">owes you</span><span className="num font-semibold">{formatINR(n)}</span></>
                            : n < 0n ? <><span className="block text-muted">you owe</span><span className="num font-semibold">{formatINR(-n)}</span></>
                            : <span className="text-muted">Settled</span>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          <p className="mt-3 text-center text-sm">
            <Link href={showArchived ? "/people" : "/people?archived=1"} className="inline-flex min-h-11 items-center text-accent">
              {showArchived ? "Hide archived" : "Show archived"}
            </Link>
          </p>
        </div>
      </Main>
    </>
  );
}
