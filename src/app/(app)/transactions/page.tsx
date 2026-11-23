import type { Metadata } from "next";
import Link from "next/link";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { listTransactions, listFilterSchema } from "@/server/services/transactions";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { listPeople } from "@/server/services/people";
import { Card, EmptyState, LinkButton, Main, PageHeader } from "@/components/ui";
import { TxnRow } from "@/components/txn-row";
import { FreshData } from "@/components/fresh-data";
import { dataStamp } from "@/server/stamp";
import { TXN_LABELS, TXN_TYPES } from "@/lib/txn-types";

export const metadata: Metadata = { title: "Entries" };

const sel = "block w-full min-h-11 rounded-xl border border-line bg-surface px-3 text-base";

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const owner = await requireOwnerPage();
  const raw = await searchParams;
  const f = listFilterSchema.parse(raw);
  const [list, accounts, categories, people] = await Promise.all([
    listTransactions(db(), owner, f),
    listAccounts(db(), owner, { includeArchived: true }),
    listCategories(db(), owner, { includeArchived: true }),
    listPeople(db(), owner, { includeArchived: true }),
  ]);
  const active = Object.entries(f).filter(([k, v]) => v && k !== "cursor").length;
  const nextParams = new URLSearchParams(Object.entries({ ...f, cursor: list.nextCursor ?? undefined }).filter(([, v]) => v) as [string, string][]);

  return (
    <FreshData stamp={dataStamp(list.items.map((t) => [t.id, t.version]))}>
      <PageHeader title="Entries" action={<LinkButton href="/add" variant="ghost">Add</LinkButton>} />
      <Main>
        {/* GET form: filtering only reads data. */}
        <form method="get" className="space-y-2" role="search">
          <label htmlFor="q" className="sr-only">Search entries</label>
          <input id="q" name="q" type="search" defaultValue={f.q} placeholder="Search notes, people, categories, accounts" className={sel} />
          <details open={active > (f.q ? 1 : 0)}>
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-accent">Filters{active ? ` (${active} active)` : ""}</summary>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <label className="text-sm">Type
                <select name="type" defaultValue={f.type ?? ""} className={sel}>
                  <option value="">All</option>
                  {TXN_TYPES.map((t) => <option key={t} value={t}>{TXN_LABELS[t].short}</option>)}
                </select>
              </label>
              <label className="text-sm">Account
                <select name="accountId" defaultValue={f.accountId ?? ""} className={sel}>
                  <option value="">All</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="text-sm">Category
                <select name="categoryId" defaultValue={f.categoryId ?? ""} className={sel}>
                  <option value="">All</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
                </select>
              </label>
              <label className="text-sm">Person
                <select name="personId" defaultValue={f.personId ?? ""} className={sel}>
                  <option value="">All</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.label ? ` (${p.label})` : ""}</option>)}
                </select>
              </label>
              <label className="text-sm">From
                <input type="date" name="from" defaultValue={f.from} className={sel} />
              </label>
              <label className="text-sm">To
                <input type="date" name="to" defaultValue={f.to} className={sel} />
              </label>
            </div>
          </details>
          <div className="flex gap-2">
            <button type="submit" className="min-h-11 flex-1 rounded-xl bg-accent px-4 font-medium text-accent-ink">Apply</button>
            {active > 0 && <Link href="/transactions" className="inline-flex min-h-11 items-center rounded-xl border border-line px-4">Clear</Link>}
          </div>
        </form>

        <div className="mt-4">
          {list.items.length === 0 ? (
            <EmptyState title={active ? "No entries match these filters" : "No entries yet"} action={!active && <LinkButton href="/add">Add an entry</LinkButton>} />
          ) : (
            <Card className="p-2">
              <ul className="divide-y divide-line">{list.items.map((t) => <TxnRow key={t.id} t={t} />)}</ul>
            </Card>
          )}
          {list.nextCursor && (
            <div className="mt-4 text-center">
              <Link href={`/transactions?${nextParams}`} className="inline-flex min-h-11 items-center rounded-xl border border-line px-5">Older entries</Link>
            </div>
          )}
          {f.cursor && (
            <div className="mt-2 text-center">
              <Link href={`/transactions?${new URLSearchParams(Object.entries({ ...f, cursor: undefined }).filter(([, v]) => v) as [string, string][])}`} className="inline-flex min-h-11 items-center text-sm text-accent">Back to newest</Link>
            </div>
          )}
        </div>
      </Main>
    </FreshData>
  );
}
