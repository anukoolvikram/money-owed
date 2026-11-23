import Link from "next/link";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from "lucide-react";
import type { TransactionDTO } from "@/server/services/transactions";
import { ACCOUNT_EFFECT, iouDelta, isIouType, TXN_LABELS } from "@/lib/txn-types";
import { formatDate } from "@/lib/dates";
import { formatINR } from "@/lib/money";
import { Money } from "./ui";
import { EntryActions } from "./entry-actions";
import { PersonAvatar } from "./person-avatar";

/**
 * One entry. Lending/borrowing shows the person and is green when they owe you
 * more (you lent) and red when you owe more (you borrowed).
 */
export function TxnRow({ t, hidePerson }: { t: TransactionDTO; hidePerson?: boolean }) {
  const label = TXN_LABELS[t.type];
  const iou = isIouType(t.type);
  const personText = t.personName ? `${t.personName}${t.personLabel ? ` (${t.personLabel})` : ""}` : "";
  const title =
    t.type === "transfer" ? `${t.accountName} → ${t.toAccountName}` : iou ? (hidePerson ? label.short : `${label.history} ${personText}`) : (t.categoryName ?? label.short);
  const up = iou ? iouDelta(t.type, BigInt(t.amountPaise)) > 0n : ACCOUNT_EFFECT[t.type] === 1;
  const Icon = t.type === "transfer" ? ArrowLeftRight : up ? ArrowDownLeft : ArrowUpRight;
  const sub = [formatDate(t.date), t.note].filter(Boolean).join(" · ");
  return (
    <li className="flex items-center gap-1">
      <Link href={`/transactions/${t.id}`} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-1 py-2 hover:bg-surface-2">
        {iou && t.personId && !hidePerson ? (
          <PersonAvatar id={t.personId} name={t.personName ?? "?"} color={t.personColor} />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
            <Icon size={18} aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate text-sm text-muted">{sub}</span>
        </span>
        {t.type === "transfer" ? (
          <Money paise={t.amountPaise} className="shrink-0" />
        ) : (
          <Money paise={up ? t.amountPaise : `-${t.amountPaise}`} sign="always" tone={up ? "in" : "out"} className="shrink-0 font-semibold" />
        )}
      </Link>
      <EntryActions id={t.id} version={t.version} label={`${title}, ${formatINR(BigInt(t.amountPaise))}, ${formatDate(t.date)}`} />
    </li>
  );
}
