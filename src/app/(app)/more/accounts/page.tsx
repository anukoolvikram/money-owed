import type { Metadata } from "next";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { listAccounts, listOpeningChanges } from "@/server/services/accounts";
import { ownerToday } from "@/server/services/settings";
import { Badge, Card, Main, Money, PageHeader, SectionTitle } from "@/components/ui";
import { AccountForm } from "@/components/account-forms";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const owner = await requireOwnerPage();
  const [accounts, today] = await Promise.all([listAccounts(db(), owner, { includeArchived: true }), ownerToday(db(), owner)]);
  const changes = await Promise.all(accounts.map((a) => listOpeningChanges(db(), owner, "account", a.id)));
  const total = accounts.reduce((s, a) => s + BigInt(a.balancePaise), 0n);
  return (
    <>
      <PageHeader title="Accounts" back="/more" subtitle={<>Total <span className="num">{formatINR(total)}</span></>} />
      <Main>
        <p className="mb-4 text-sm text-muted">Add the real places your money sits. UPI is a way to pay, not an account — choose the bank account it uses.</p>
        <Card>
          <h2 className="mb-3 font-semibold">Add account</h2>
          <AccountForm today={today} />
        </Card>
        <SectionTitle>Your accounts</SectionTitle>
        {accounts.length === 0 && <p className="text-sm text-muted">No accounts yet.</p>}
        <div className="space-y-3">
          {accounts.map((a, i) => {
            const bal = BigInt(a.balancePaise);
            return (
              <Card key={a.id}>
                <details>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name} {a.archived && <Badge>Archived</Badge>}</span>
                      <span className="block text-sm capitalize text-muted">{a.kind} · opened {formatDate(a.openingDate)} with {formatINR(BigInt(a.openingBalancePaise))}</span>
                    </span>
                    <span className="text-right">
                      <Money paise={a.balancePaise} className="font-semibold" />
                      {bal < 0n && <span className="block text-xs font-medium text-warn">Negative balance</span>}
                    </span>
                  </summary>
                  <div className="mt-4 border-t border-line pt-4">
                    {changes[i].length > 0 && (
                      <ul className="mb-3 space-y-1 text-xs text-muted">
                        {changes[i].map((c) => (
                          <li key={c.id}>Opening corrected: {formatINR(BigInt(c.oldPaise))} ({formatDate(c.oldDate)}) → {formatINR(BigInt(c.newPaise))} ({formatDate(c.newDate)})</li>
                        ))}
                      </ul>
                    )}
                    <AccountForm today={today} account={a} />
                  </div>
                </details>
              </Card>
            );
          })}
        </div>
      </Main>
    </>
  );
}
