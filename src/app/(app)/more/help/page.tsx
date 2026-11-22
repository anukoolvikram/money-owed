import type { Metadata } from "next";
import { requireOwnerPage } from "@/server/auth/guard";
import { Card, Main, PageHeader, SectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Help" };

const rows = [
  ["I spent (Expense)", "Money leaves an account", "Counts as spending and uses budget"],
  ["I earned (Income)", "Money enters an account", "Counts as income"],
  ["I moved money (Transfer)", "One account down, another up", "Not income or spending"],
  ["I lent", "Money leaves an account", "They owe you more"],
  ["I borrowed", "Money enters an account", "You owe them more"],
  ["They repaid me", "Money enters an account", "They owe you less"],
  ["I repaid them", "Money leaves an account", "You owe them less"],
];

export default async function HelpPage() {
  await requireOwnerPage();
  return (
    <>
      <PageHeader title="Help" back="/more" />
      <Main className="space-y-1 text-[15px]">
        <SectionTitle>Entry types</SectionTitle>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2"><tr><th className="p-2">Type</th><th className="p-2">Account</th><th className="p-2">Effect</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r[0]} className="border-t border-line">{r.map((c, i) => <td key={i} className="p-2">{c}</td>)}</tr>)}</tbody>
          </table>
        </Card>
        <SectionTitle>People &amp; IOUs</SectionTitle>
        <Card className="space-y-2">
          <p>Each person has one running balance: starting balance + what you lent + what you repaid them − what you borrowed − what they repaid you.</p>
          <p><b>Positive</b> means they owe you. <b>Negative</b> means you owe them. <b>Zero</b> means settled. You can lend and borrow with the same person; the full dated history is kept.</p>
          <p>“Owed to me” and “I owe” are totalled separately across people and never cancel each other out.</p>
          <p>Repayments are not matched to individual loans. Interest, write-offs and splitting bills are not supported yet.</p>
        </Card>
        <SectionTitle>Good to know</SectionTitle>
        <Card className="space-y-2">
          <p><b>Refunds</b> aren’t a separate type yet. Don’t record a refund as income (it would look like earnings). For now, edit or reduce the original expense.</p>
          <p><b>UPI</b> is a payment method, not an account: pick the bank account the money came from.</p>
          <p>Opening balances are what an account (or person) held when you started. They are not income and don’t affect budgets.</p>
          <p>Only asset accounts (cash, bank, wallet) are supported. Credit cards, investments and other currencies are not.</p>
          <p>Future dates can’t be saved. The app needs an internet connection; if saving fails, it says so and your entry stays on screen to retry.</p>
          <p>Budget warnings appear inside the app only. There are no phone notifications.</p>
        </Card>
        <SectionTitle>Add to Home Screen (iPhone)</SectionTitle>
        <Card className="space-y-2">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open the app in Safari and sign in.</li>
            <li>Tap the Share button, then “Add to Home Screen”.</li>
            <li>Tap Add. The icon opens the app full-screen.</li>
          </ol>
          <p className="text-sm text-muted">This is a web app: it does not work offline, keep data on the phone, or provide widgets, Siri, bank sync or SMS reading.</p>
        </Card>
      </Main>
    </>
  );
}
