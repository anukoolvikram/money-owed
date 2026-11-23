import type { Metadata } from "next";
import { requireOwnerPage } from "@/server/auth/guard";
import { Card, Main, PageHeader, SectionTitle } from "@/components/ui";
import { displayUsername } from "@/lib/owner-login";
import { LogoutButton, RevokeAllButton } from "@/components/auth-buttons";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const owner = await requireOwnerPage();
  return (
    <>
      <PageHeader title="Security" back="/more" subtitle={displayUsername(owner.email)} />
      <Main>
        <SectionTitle>Username and password</SectionTitle>
        <Card className="space-y-2 text-sm">
          <p>Your login comes from the <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> environment variables. To change it, update them where the app is hosted and redeploy.</p>
          <p>After a change, every device is signed out and the next sign-in uses the new values. Your ledger data is kept.</p>
        </Card>
        <SectionTitle>Sessions</SectionTitle>
        <Card className="space-y-3">
          <p className="text-sm">Sessions last 7 days, then you sign in again.</p>
          <div className="flex flex-wrap gap-2"><LogoutButton /><RevokeAllButton /></div>
        </Card>
        <SectionTitle>What this protects</SectionTitle>
        <Card className="space-y-2 text-sm">
          <p>Login stops other people using this app. It is not end-to-end encryption.</p>
          <p>The owners of the hosting (Vercel) and database (Neon) accounts, their authorised administrators, and the providers themselves can technically access the stored data. Protect those accounts and your code repository with multi-factor authentication.</p>
        </Card>
      </Main>
    </>
  );
}
