import type { Metadata } from "next";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { getEntryFormData } from "@/server/services/form-data";
import { EntryForm } from "@/components/entry-form";
import { Main, PageHeader } from "@/components/ui";
import { TXN_TYPES, type TxnType } from "@/lib/txn-types";

export const metadata: Metadata = { title: "Add" };

// /add?type=lend&person=<id> only PRESELECTS fields. It never creates a record;
// saving always needs a signed-in owner pressing Save.
export default async function AddPage({ searchParams }: { searchParams: Promise<{ type?: string; person?: string }> }) {
  const owner = await requireOwnerPage();
  const sp = await searchParams;
  const data = await getEntryFormData(db(), owner);
  const type = (TXN_TYPES as readonly string[]).includes(sp.type ?? "") ? (sp.type as TxnType) : undefined;
  const person = data.people.some((p) => p.id === sp.person) ? sp.person : undefined;
  return (
    <>
      <PageHeader title="Add entry" />
      <Main>
        <EntryForm data={data} initialType={type} initialPersonId={person} />
      </Main>
    </>
  );
}
