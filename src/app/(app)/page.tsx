import Link from "next/link";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { listPeople } from "@/server/services/people";
import { listTransactions } from "@/server/services/transactions";
import { ownerToday } from "@/server/services/settings";
import { iouTotals } from "@/server/services/ledger-sql";
import { Card, Main, Money, PageHeader, SectionTitle } from "@/components/ui";
import { TxnRow } from "@/components/txn-row";
import { QuickIou } from "@/components/quick-iou";
import { PersonAvatar } from "@/components/person-avatar";
import { AddPersonInline } from "@/components/add-person-inline";
import { RemovePerson } from "@/components/remove-person";
import { FreshData } from "@/components/fresh-data";
import { dataStamp } from "@/server/stamp";
import { personColor } from "@/lib/person-color";

export default async function HomePage() {
  const owner = await requireOwnerPage();
  const [people, recent, today] = await Promise.all([
    listPeople(db(), owner),
    listTransactions(db(), owner, {}, 10),
    ownerToday(db(), owner),
  ]);
  const totals = iouTotals(people.map((p) => BigInt(p.netPaise)));
  const net = totals.owedToMe - totals.iOwe;
  // Largest "they owe me" first, largest "I owe" last, settled at the end.
  const sorted = [...people].sort((a, b) => {
    const x = BigInt(a.netPaise), y = BigInt(b.netPaise);
    if ((x === 0n) !== (y === 0n)) return x === 0n ? 1 : -1;
    return y > x ? 1 : y < x ? -1 : 0;
  });

  const stamp = dataStamp(
    people.map((p) => [p.id, p.name, p.label, p.color, p.netPaise, p.version]),
    recent.items.map((t) => [t.id, t.version]),
  );

  return (
    <FreshData stamp={stamp}>
      <PageHeader title="Money" />
      <Main>
        <QuickIou today={today} people={people.map((p) => ({ id: p.id, name: p.name, label: p.label }))} />

        <div className="mt-4 grid grid-cols-2 gap-3">
          <Card>
            <p className="text-sm text-muted">Total lent</p>
            <Money paise={totals.owedToMe} tone="in" className="text-xl font-semibold" />
          </Card>
          <Card>
            <p className="text-sm text-muted">Total owed</p>
            <Money paise={totals.iOwe} tone="out" className="text-xl font-semibold" />
          </Card>
        </div>
        <Card className="mt-3 flex items-center justify-between">
          <p className="text-sm text-muted">{net > 0n ? "Net: you'll get" : net < 0n ? "Net: you owe" : "Net"}</p>
          <Money paise={net} sign="always" tone={net > 0n ? "in" : net < 0n ? "out" : "neutral"} className="text-xl font-semibold" />
        </Card>

        <SectionTitle>People</SectionTitle>
        {sorted.length > 0 && (
          <Card className="mb-3 p-2">
            <ul className="divide-y divide-line">
              {sorted.map((p) => {
                const n = BigInt(p.netPaise);
                return (
                  <li key={p.id} className="flex items-center gap-1">
                    <Link
                      href={`/people/${p.id}`}
                      style={{ borderLeftColor: personColor(p.id, p.color) }}
                      className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-l-md border-l-4 px-2 py-2 hover:bg-surface-2"
                    >
                      <PersonAvatar id={p.id} name={p.name} color={p.color} />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {p.name} {p.label && <span className="font-normal text-muted">({p.label})</span>}
                      </span>
                      {n === 0n ? (
                        <span className="text-sm text-muted">Settled</span>
                      ) : (
                        <Money paise={n} sign="always" tone={n > 0n ? "in" : "out"} className="shrink-0 font-semibold" />
                      )}
                    </Link>
                    <RemovePerson id={p.id} name={p.name} />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        <AddPersonInline today={today} />

        {recent.items.length > 0 && (
          <>
            <SectionTitle action={<Link href="/transactions" className="inline-flex min-h-11 items-center text-sm text-accent">See all</Link>}>Recent</SectionTitle>
            <Card className="p-2">
              <ul className="divide-y divide-line">{recent.items.map((t) => <TxnRow key={t.id} t={t} />)}</ul>
            </Card>
          </>
        )}
      </Main>
    </FreshData>
  );
}
