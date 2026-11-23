import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { getPersonDetail } from "@/server/services/people";
import { listTransactions } from "@/server/services/transactions";
import { ownerToday } from "@/server/services/settings";
import { ServiceError } from "@/server/services/errors";
import { Card, Main, Money, PageHeader, SectionTitle } from "@/components/ui";
import { PersonForm } from "@/components/person-form";
import { PersonAvatar } from "@/components/person-avatar";
import { QuickIou } from "@/components/quick-iou";
import { TxnRow } from "@/components/txn-row";
import { RemovePerson } from "@/components/remove-person";
import { FreshData } from "@/components/fresh-data";
import { dataStamp } from "@/server/stamp";
import { personColor } from "@/lib/person-color";
import { PersonColorPicker } from "@/components/person-color-picker";

export const metadata: Metadata = { title: "Person" };

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwnerPage();
  const { id } = await params;
  let detail;
  try {
    detail = await getPersonDetail(db(), owner, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === "not_found") notFound();
    throw e;
  }
  const { person } = detail;
  const [entries, today] = await Promise.all([listTransactions(db(), owner, { personId: id }, 500), ownerToday(db(), owner)]);
  const net = BigInt(person.netPaise);
  const color = personColor(person.id, person.color);

  const stamp = dataStamp([person.name, person.label, person.color, person.netPaise, person.version, person.archived], entries.items.map((t) => [t.id, t.version]));

  return (
    <FreshData stamp={stamp}>
      <PageHeader title={person.name} subtitle={person.label ?? undefined} back="/" action={<RemovePerson id={person.id} name={person.name} redirectTo="/" />} />
      <Main>
        <Card className="flex items-center gap-4 border-l-8" style={{ borderLeftColor: color }}>
          <PersonAvatar id={person.id} name={person.name} color={person.color} size="lg" />
          <div>
            <p className="text-sm text-muted">{net > 0n ? `${person.name} has to pay you` : net < 0n ? `You have to pay ${person.name}` : "Settled"}</p>
            <Money paise={net} sign="always" tone={net > 0n ? "in" : net < 0n ? "out" : "neutral"} className="text-2xl font-semibold" />
          </div>
        </Card>

        {!person.archived && (
          <div className="mt-4">
            <QuickIou today={today} people={[]} fixedPerson={{ id: person.id, name: person.name }} />
          </div>
        )}

        <SectionTitle>Transactions</SectionTitle>
        {entries.items.length === 0 ? (
          <p className="px-1 text-sm text-muted">No transactions yet.</p>
        ) : (
          <Card className="p-2">
            <ul className="divide-y divide-line">{entries.items.map((t) => <TxnRow key={t.id} t={t} hidePerson />)}</ul>
          </Card>
        )}

        <SectionTitle>Colour tag</SectionTitle>
        <Card>
          <PersonColorPicker id={person.id} current={color} />
        </Card>

        <details className="mt-6 rounded-2xl border border-line bg-surface">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm text-muted">Edit person</summary>
          <div className="px-4 pb-4">
            <PersonForm today={today} person={person} />
          </div>
        </details>
      </Main>
    </FreshData>
  );
}
