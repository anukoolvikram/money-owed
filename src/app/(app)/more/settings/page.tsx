import type { Metadata } from "next";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { getSettings } from "@/server/services/settings";
import { Card, Main, PageHeader } from "@/components/ui";
import { SettingsForm } from "@/components/settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const owner = await requireOwnerPage();
  const s = await getSettings(db(), owner);
  return (
    <>
      <PageHeader title="Settings" back="/more" />
      <Main>
        <Card><SettingsForm initial={s} /></Card>
        <p className="mt-4 text-sm text-muted">Currency: Indian rupee (₹), Indian number format.</p>
      </Main>
    </>
  );
}
