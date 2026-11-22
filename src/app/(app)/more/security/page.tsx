import type { Metadata } from "next";
import { requireOwnerPage } from "@/server/auth/guard";
import { Card, Main, PageHeader, SectionTitle } from "@/components/ui";
import { ChangePasswordForm } from "@/components/password-form";
import { LogoutButton, RevokeAllButton } from "@/components/auth-buttons";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const owner = await requireOwnerPage();
  return (
    <>
      <PageHeader title="Security" back="/more" subtitle={owner.email} />
      <Main>
        <Card><ChangePasswordForm /></Card>
        <SectionTitle>Sessions</SectionTitle>
        <Card className="space-y-3">
          <p className="text-sm">Sessions last 7 days, then you sign in again.</p>
          <div className="flex flex-wrap gap-2"><LogoutButton /><RevokeAllButton /></div>
        </Card>
        <SectionTitle>What this protects</SectionTitle>
        <Card className="space-y-2 text-sm">
          <p>Login stops other people using this app. It is not end-to-end encryption.</p>
          <p>The owners of the hosting (Vercel) and database (Neon) accounts, their authorised administrators, and the providers themselves can technically access the stored data. Protect those accounts and your code repository with multi-factor authentication.</p>
          <p>Forgot your passphrase? The operator can reset it with the terminal recovery command (see README). There is no email reset.</p>
        </Card>
      </Main>
    </>
  );
}
