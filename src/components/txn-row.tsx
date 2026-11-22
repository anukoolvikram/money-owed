import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, HandCoins } from "lucide-react";
import type { TransactionDTO } from "@/server/services/transactions";
import { ACCOUNT_EFFECT, isIouType, PAYMENT_LABELS, TXN_LABELS } from "@/lib/txn-types";
import { formatDate } from "@/lib/dates";
import { Money } from "./ui";

/** One entry. Direction is conveyed by the icon label, the +/− sign and words — not colour alone. */
export function TxnRow({ t }: { t: TransactionDTO }) {
  const label = TXN_LABELS[t.type];
  const personText = t.personName ? `${t.personName}${t.personLabel ? ` (${t.personLabel})` : ""}` : null;
  const title =
    t.type === "transfer"
      ? `${t.accountName} → ${t.toAccountName}`
      : isIouType(t.type)
        ? `${label.history} ${personText}`
        : (t.categoryName ?? label.short);
  const isIn = ACCOUNT_EFFECT[t.type] === 1;
  const Icon = t.type === "transfer" ? ArrowLeftRight : isIouType(t.type) ? HandCoins : isIn ? ArrowDownLeft : ArrowUpRight;
  const sub = [label.short, t.type === "transfer" ? null : t.accountName, t.paymentMethod ? PAYMENT_LABELS[t.paymentMethod] : null, formatDate(t.date)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <Link href={`/transactions/${t.id}`} className="flex min-h-16 items-center gap-3 px-1 py-2 hover:bg-surface-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
          <Icon size={18} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-sm text-muted">{sub}</span>
          {t.note && <span className="block truncate text-sm text-muted">“{t.note}”</span>}
        </span>
        <span className="shrink-0 text-right">
          {t.type === "transfer" ? (
            <Money paise={t.amountPaise} />
          ) : (
            <Money paise={isIn ? t.amountPaise : `-${t.amountPaise}`} sign="always" tone={isIn ? "in" : "out"} />
          )}
          <span className="sr-only">{t.type === "transfer" ? " moved" : isIn ? " money in" : " money out"}</span>
        </span>
      </Link>
    </li>
  );
}
