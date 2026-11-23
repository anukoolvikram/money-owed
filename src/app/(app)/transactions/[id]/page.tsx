import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { getTransaction } from "@/server/services/transactions";
import { getEntryFormData } from "@/server/services/form-data";
import { ServiceError } from "@/server/services/errors";
import { EntryForm } from "@/components/entry-form";
import { QuickIou } from "@/components/quick-iou";
import { listPeople } from "@/server/services/people";
import { ownerToday } from "@/server/services/settings";
import { Main, PageHeader } from "@/components/ui";
import { paiseToInput } from "@/lib/money";
import { iouDelta } from "@/lib/txn-types";

export const metadata: Metadata = { title: "Edit entry" };

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwnerPage();
  const { id } = await params;
  let t;
  try {
    t = await getTransaction(db(), owner, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === "not_found") notFound();
    throw e;
  }
  if ((t.type === "lend" || t.type === "borrow") && t.personId) {
    const [people, today] = await Promise.all([listPeople(db(), owner), ownerToday(db(), owner)]);
    // Keep the entry's own person in the list even if they were archived since.
    const options = people.some((p) => p.id === t.personId) ? people : [...people, { id: t.personId, name: t.personName ?? "?", label: t.personLabel }];
    const back = `/people/${t.personId}`;
    return (
      <>
        <PageHeader title="Edit" back={back} />
        <Main>
          <QuickIou
            today={today}
            people={options.map((p) => ({ id: p.id, name: p.name, label: p.label }))}
            editing={{ id: t.id, version: t.version, type: t.type, amount: paiseToInput(BigInt(t.amountPaise)), date: t.date, note: t.note ?? "", personId: t.personId, back }}
          />
        </Main>
      </>
    );
  }
  const data = await getEntryFormData(db(), owner, { accountIds: [t.accountId, t.toAccountId], categoryId: t.categoryId, personId: t.personId });
  return (
    <>
      <PageHeader title="Edit entry" back="/transactions" />
      <Main>
        <EntryForm
          data={data}
          editing={{
            id: t.id,
            version: t.version,
            type: t.type,
            amount: paiseToInput(BigInt(t.amountPaise)),
            date: t.date,
            accountId: t.accountId,
            toAccountId: t.toAccountId,
            categoryId: t.categoryId,
            personId: t.personId,
            note: t.note,
            paymentMethod: t.paymentMethod,
            ownIouDeltaPaise: iouDelta(t.type, BigInt(t.amountPaise)).toString(),
          }}
        />
      </Main>
    </>
  );
}
