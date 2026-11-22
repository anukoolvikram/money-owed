import type { Metadata } from "next";
import { requireOwnerPage } from "@/server/auth/guard";
import { db } from "@/server/db/client";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { buttonClass, Card, Main, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { CsvImportTool, RestoreTool } from "@/components/data-tools";

export const metadata: Metadata = { title: "Export & import" };

export default async function DataPage() {
  const owner = await requireOwnerPage();
  const [accounts, cats] = await Promise.all([listAccounts(db(), owner), listCategories(db(), owner)]);
  return (
    <>
      <PageHeader title="Export, import & backup" back="/more" />
      <Main>
        <Notice tone="warn" title="Downloaded files contain your private data">
          They are not encrypted. Store them somewhere private (for example an encrypted drive), don’t share them, and delete old copies manually when you no longer need them.
        </Notice>
        <SectionTitle>Export</SectionTitle>
        <Card className="space-y-3">
          <div>
            {/* Plain links (GET downloads). The routes check the owner session and send no-store headers. */}
            <a href="/api/export/json" className={buttonClass("primary") + " w-full"} download>Download full backup (JSON)</a>
            <p className="mt-1 text-xs text-muted">Everything: settings, accounts and opening balances, categories, people, entries, budgets. Use this to restore.</p>
          </div>
          <div>
            <a href="/api/export/csv" className={buttonClass("secondary") + " w-full"} download>Download entries (CSV)</a>
            <p className="mt-1 text-xs text-muted">A transaction list for spreadsheets. <strong>Not a full backup</strong> — it lacks opening balances, budgets and settings.</p>
          </div>
        </Card>
        <SectionTitle>Restore a backup</SectionTitle>
        <Card><RestoreTool /></Card>
        <SectionTitle>Import entries from CSV</SectionTitle>
        <Card className="space-y-3">
          <p className="text-sm">
            Use the <a className="text-accent underline" href="/api/template" download>CSV template</a>, or map your own sheet’s Date, Person, Money out, Money in and Note columns.
          </p>
          <details className="text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-accent">Template columns explained</summary>
            <ul className="list-disc space-y-1 pl-5 text-muted">
              <li><b>date</b>: 2026-01-31 (or choose another format when importing)</li>
              <li><b>type</b>: expense, income, transfer, lend, borrow, repayment_received, repayment_paid</li>
              <li><b>amount</b>: positive rupees, up to 2 decimals, e.g. 1500.50</li>
              <li><b>account</b>: exact name of an existing account; <b>to_account</b> for transfers</li>
              <li><b>category</b>: for expense/income; must match an existing category of that kind</li>
              <li><b>person</b> (+ optional <b>person_label</b>): for lend/borrow/repayments</li>
              <li><b>payment_method</b>: cash, upi, card, netbanking, wallet, other (optional); <b>note</b>: optional</li>
            </ul>
          </details>
          <CsvImportTool
            accounts={accounts.map((a) => a.name)}
            expenseCategories={cats.filter((c) => c.kind === "expense").map((c) => c.name)}
            incomeCategories={cats.filter((c) => c.kind === "income").map((c) => c.name)}
          />
        </Card>
      </Main>
    </>
  );
}
