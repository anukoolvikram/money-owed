import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { getPersonDetail } from "@/server/services/people";
import { listOpeningChanges } from "@/server/services/accounts";
import { ownerToday } from "@/server/services/settings";
import { ServiceError } from "@/server/services/errors";
import { Badge, buttonClass, Card, EmptyState, Main, Money, PageHeader, SectionTitle } from "@/components/ui";
import { PersonForm } from "@/components/person-form";
import { formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { TXN_LABELS } from "@/lib/txn-types";

export const metadata: Metadata = { title: "Person" };

function words(n: bigint, name: string) {
  if (n > 0n) return `${name} owes you ${formatINR(n)}`;
  if (n < 0n) return `You owe ${name} ${formatINR(-n)}`;
  return `You and ${name} are settled`;
}

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
  const { person, history } = detail;
  const [changes, today] = await Promise.all([listOpeningChanges(db(), owner, "person", id), ownerToday(db(), owner)]);
  const net = BigInt(person.netPaise);
  const opening = BigInt(person.openingIouPaise);
  const actions = [
    { type: "lend", label: "I lent" },
    { type: "repayment_received", label: "They repaid me" },
    { type: "borrow", label: "I borrowed" },
    { type: "repayment_paid", label: "I repaid them" },
  ];
  return (
    <>
      <PageHeader title={person.name} subtitle={person.label ?? undefined} back="/people" />
      <Main>
        <Card>
          {person.archived && <Badge>Archived</Badge>}
          <p className="text-xl font-semibold">{words(net, person.name)}</p>
          <p className="mt-1 text-sm text-muted">
            Starting balance on {formatDate(person.openingDate)}: {opening === 0n ? "none" : opening > 0n ? `they owed you ${formatINR(opening)}` : `you owed them ${formatINR(-opening)}`}
          </p>
        </Card>
        {!person.archived && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {actions.map((a) => (
              <Link key={a.type} href={`/add?type=${a.type}&person=${person.id}`} className={buttonClass("secondary")}>{a.label}</Link>
            ))}
          </div>
        )}

        <SectionTitle>History</SectionTitle>
        {history.length === 0 ? (
          <EmptyState title="No entries yet" />
        ) : (
          <Card className="p-2">
            <ul className="divide-y divide-line">
              {history.map((h) => {
                const d = BigInt(h.deltaPaise);
                return (
                  <li key={h.id}>
                    <Link href={`/transactions/${h.id}`} className="flex min-h-16 items-center justify-between gap-3 px-2 py-2 hover:bg-surface-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{TXN_LABELS[h.type].short} <Money paise={h.amountPaise} /></span>
                        <span className="block truncate text-sm text-muted">{formatDate(h.date)} · {h.accountName}{h.note ? ` · “${h.note}”` : ""}</span>
                      </span>
                      <span className="shrink-0 text-right text-sm">
                        <span className="block text-muted">{d > 0n ? "they owe more" : "they owe less"}</span>
                        <span className="num">Balance {formatINR(BigInt(h.runningPaise), { sign: "always" })}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="px-2 pb-1 pt-2 text-xs text-muted">Balance: + means they owe you, − means you owe them.</p>
          </Card>
        )}

        {changes.length > 0 && (
          <>
            <SectionTitle>Opening balance corrections</SectionTitle>
            <Card>
              <ul className="space-y-1 text-sm">
                {changes.map((c) => (
                  <li key={c.id}>Changed from {formatINR(BigInt(c.oldPaise), { sign: "always" })} ({formatDate(c.oldDate)}) to {formatINR(BigInt(c.newPaise), { sign: "always" })} ({formatDate(c.newDate)}). Not an entry.</li>
                ))}
              </ul>
            </Card>
          </>
        )}

        <SectionTitle>Edit person</SectionTitle>
        <Card>
          <PersonForm today={today} person={person} />
        </Card>
      </Main>
    </>
  );
}
