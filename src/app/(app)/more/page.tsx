import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireOwnerPage } from "@/server/auth/guard";
import { Card, Main, PageHeader } from "@/components/ui";
import { LogoutButton } from "@/components/auth-buttons";

export const metadata: Metadata = { title: "More" };

const links = [
  { href: "/more/accounts", label: "Accounts", sub: "Cash, bank and wallets" },
  { href: "/more/categories", label: "Categories", sub: "Expense and income categories" },
  { href: "/more/budgets", label: "Budgets", sub: "Overall and category limits per cycle" },
  { href: "/more/settings", label: "Settings", sub: "Timezone, budget start day, theme" },
  { href: "/more/security", label: "Security", sub: "Passphrase and sessions" },
  { href: "/more/data", label: "Export, import & backup", sub: "CSV and full JSON backup" },
  { href: "/more/help", label: "Help", sub: "How entries work, Add to Home Screen" },
];

export default async function MorePage() {
  const owner = await requireOwnerPage();
  return (
    <>
      <PageHeader title="More" subtitle={owner.email} />
      <Main>
        <Card className="p-1">
          <ul className="divide-y divide-line">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="flex min-h-16 items-center justify-between gap-3 px-3 py-2 hover:bg-surface-2">
                  <span>
                    <span className="block font-medium">{l.label}</span>
                    <span className="block text-sm text-muted">{l.sub}</span>
                  </span>
                  <ChevronRight size={18} className="text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <LogoutButton className="mt-6 w-full" />
      </Main>
    </>
  );
}
