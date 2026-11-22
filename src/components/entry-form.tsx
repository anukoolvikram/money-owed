"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createTransactionAction, deleteTransactionAction, updateTransactionAction } from "@/app/actions/ledger";
import { Button, ConfirmDialog, Field, inputClass, Select, StatusText, TextInput } from "./client";
import { cx } from "./ui";
import { formatINR, parseRupees } from "@/lib/money";
import { iouDelta, isCategoryType, isIouType, PAYMENT_LABELS, PAYMENT_METHODS, TXN_LABELS, TXN_TYPES, type TxnType } from "@/lib/txn-types";

export type EntryFormData = {
  today: string;
  accounts: { id: string; name: string; kind: string; balancePaise: string; openingDate: string }[];
  categories: { id: string; name: string; kind: "expense" | "income"; useCount: number }[];
  people: { id: string; name: string; label: string | null; netPaise: string }[];
};

export type EditingEntry = {
  id: string;
  version: number;
  type: TxnType;
  amount: string;
  date: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  personId: string | null;
  note: string | null;
  paymentMethod: string | null;
  /** The entry's own effect on the person's balance, so "before" excludes it. */
  ownIouDeltaPaise: string;
};

const LAST_ACCOUNT_KEY = "ledger:lastAccountId"; // only an id preference, never financial data

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `add-${crypto.randomUUID()}` : `add-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function iouWords(n: bigint) {
  if (n > 0n) return `owes you ${formatINR(n)}`;
  if (n < 0n) return `you owe ${formatINR(-n)}`;
  return "settled";
}

export function EntryForm({ data, initialType, initialPersonId, editing }: { data: EntryFormData; initialType?: TxnType; initialPersonId?: string; editing?: EditingEntry }) {
  const router = useRouter();
  const [type, setType] = useState<TxnType>(editing?.type ?? initialType ?? "expense");
  const [amount, setAmount] = useState(editing?.amount ?? "");
  const [date, setDate] = useState(editing?.date ?? data.today);
  const [accountId, setAccountId] = useState(editing?.accountId ?? data.accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(editing?.toAccountId ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [personId, setPersonId] = useState(editing?.personId ?? initialPersonId ?? "");
  const [personQuery, setPersonQuery] = useState("");
  const [note, setNote] = useState(editing?.note ?? "");
  const [paymentMethod, setPaymentMethod] = useState(editing?.paymentMethod ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ message: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const keyRef = useRef<string>(newKey());
  const inFlight = useRef(false);
  const amountRef = useRef<HTMLInputElement>(null);

  // Restore the last-used account (a harmless preference) for new entries.
  useEffect(() => {
    if (editing) return;
    try {
      const last = localStorage.getItem(LAST_ACCOUNT_KEY);
      // Syncing from an external store (localStorage) after hydration; reading it during
      // render would make server and client HTML differ.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (last && data.accounts.some((a) => a.id === last)) setAccountId(last);
    } catch {}
  }, [editing, data.accounts]);

  const cats = useMemo(
    () => data.categories.filter((c) => c.kind === type).sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name)),
    [data.categories, type],
  );
  const quickCats = cats.slice(0, 8);
  const person = data.people.find((p) => p.id === personId);
  const filteredPeople = useMemo(() => {
    const q = personQuery.trim().toLowerCase();
    return q ? data.people.filter((p) => p.name.toLowerCase().includes(q) || (p.label ?? "").toLowerCase().includes(q)) : data.people;
  }, [data.people, personQuery]);

  const parsed = parseRupees(amount);
  let iouPreview: { before: bigint; after: bigint } | null = null;
  if (isIouType(type) && person) {
    let before = BigInt(person.netPaise);
    if (editing && editing.personId === person.id) before -= BigInt(editing.ownIouDeltaPaise);
    iouPreview = { before, after: before + (parsed.ok ? iouDelta(type, parsed.paise) : 0n) };
  }

  function buildPayload(confirmCrossZero = false) {
    return {
      type,
      amount,
      date,
      accountId,
      toAccountId: type === "transfer" ? toAccountId : undefined,
      categoryId: isCategoryType(type) ? categoryId : undefined,
      personId: isIouType(type) ? personId : undefined,
      note,
      paymentMethod: type === "transfer" ? undefined : paymentMethod,
      confirmCrossZero,
    };
  }

  function clientValidate(): boolean {
    const e: Record<string, string> = {};
    if (!parsed.ok) e.amount = parsed.error;
    if (!accountId) e.accountId = "Choose an account.";
    if (type === "transfer" && (!toAccountId || toAccountId === accountId)) e.toAccountId = "Choose a different account to move money to.";
    if (isCategoryType(type) && !categoryId) e.categoryId = "Choose a category.";
    if (isIouType(type) && !personId) e.personId = "Choose a person.";
    if (date > data.today) e.date = "Future dates are not allowed.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit(confirmCrossZero = false) {
    if (inFlight.current) return; // prevent repeat taps
    if (!clientValidate()) {
      setStatus({ tone: "error", text: "Not saved. Fix the highlighted fields." });
      return;
    }
    inFlight.current = true;
    setStatus(null);
    startTransition(async () => {
      try {
        const res = editing
          ? await updateTransactionAction({ ...buildPayload(confirmCrossZero), id: editing.id, version: editing.version })
          : await createTransactionAction({ ...buildPayload(confirmCrossZero), idempotencyKey: keyRef.current });
        if (res.ok) {
          setConfirm(null);
          setErrors({});
          try {
            localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
          } catch {}
          if (editing) {
            router.push("/transactions");
            return;
          }
          setStatus({ tone: "ok", text: `Saved: ${TXN_LABELS[type].short} ${parsed.ok ? formatINR(parsed.paise) : ""}` });
          keyRef.current = newKey(); // the next entry is a new submission
          setAmount("");
          setNote("");
          amountRef.current?.focus();
        } else if (res.code === "needs_confirmation") {
          setConfirm({ message: res.message });
        } else if (res.code === "unauthorized") {
          // Deliberate full reload: drops all in-memory private state when the session has ended.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        } else {
          setErrors(res.fieldErrors ?? {});
          setStatus({ tone: "error", text: `Not saved. ${res.message}` });
        }
      } catch {
        // Network failure: the key is kept, so retrying cannot create a duplicate.
        setStatus({ tone: "error", text: "Not saved: could not reach the server. Your entry is still here — tap Save to retry." });
      } finally {
        inFlight.current = false;
      }
    });
  }

  function doDelete() {
    if (!editing || inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      try {
        const res = await deleteTransactionAction({ id: editing.id, version: editing.version });
        if (res.ok) router.push("/transactions");
        else setStatus({ tone: "error", text: res.message });
      } catch {
        setStatus({ tone: "error", text: "Not deleted: could not reach the server." });
      } finally {
        inFlight.current = false;
        setConfirmDelete(false);
      }
    });
  }

  const noAccounts = data.accounts.length === 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      className="space-y-5"
      noValidate
    >
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium">What happened?</legend>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Entry type">
          {TXN_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => {
                setType(t);
                setErrors({});
                if (t !== type) setCategoryId("");
              }}
              className={cx(
                "min-h-11 shrink-0 rounded-full border px-4 text-[15px]",
                type === t ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-ink",
              )}
            >
              {TXN_LABELS[t].action}
            </button>
          ))}
        </div>
      </fieldset>

      <Field label="Amount (₹)" htmlFor="amount" error={errors.amount}>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-muted" aria-hidden>₹</span>
          <input
            ref={amountRef}
            id="amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            autoFocus={!editing}
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={errors.amount ? true : undefined}
            aria-describedby={errors.amount ? "amount-error" : undefined}
            className={cx(inputClass, "num h-16 pl-10 text-3xl font-semibold")}
          />
        </div>
      </Field>

      {isCategoryType(type) && (
        <Field label="Category" htmlFor="categoryId" error={errors.categoryId}>
          <div className="flex flex-wrap gap-2" aria-label="Frequent categories">
            {quickCats.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
                className={cx("min-h-11 rounded-xl border px-3 text-[15px]", categoryId === c.id ? "border-accent bg-accent-soft font-medium text-accent" : "border-line bg-surface")}
              >
                {c.name}
              </button>
            ))}
          </div>
          {cats.length > quickCats.length && (
            <Select id="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} error={errors.categoryId} className="mt-2">
              <option value="">All categories…</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          )}
          {cats.length === 0 && <p className="text-sm text-muted">No {type} categories. <Link className="text-accent underline" href="/more/categories">Add one</Link>.</p>}
        </Field>
      )}

      {isIouType(type) && (
        <Field label="Person" htmlFor="personSearch" error={errors.personId}>
          {data.people.length > 6 && (
            <TextInput id="personSearch" type="search" placeholder="Search people" value={personQuery} onChange={(e) => setPersonQuery(e.target.value)} className="mb-2" />
          )}
          <ul className="max-h-64 space-y-1 overflow-y-auto" role="radiogroup" aria-label="Person" id={data.people.length > 6 ? undefined : "personSearch"}>
            {filteredPeople.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={personId === p.id}
                  onClick={() => setPersonId(p.id)}
                  className={cx("flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border px-3 text-left", personId === p.id ? "border-accent bg-accent-soft" : "border-line bg-surface")}
                >
                  <span className="min-w-0 truncate">
                    {p.name} {p.label && <span className="text-muted">({p.label})</span>}
                  </span>
                  <span className="shrink-0 text-sm text-muted">{iouWords(BigInt(p.netPaise))}</span>
                </button>
              </li>
            ))}
          </ul>
          {data.people.length === 0 && (
            <p className="text-sm text-muted">No people yet. <Link className="text-accent underline" href="/people?new=1">Add a person</Link>.</p>
          )}
          {iouPreview && (
            <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm" aria-live="polite">
              <div>Before: {person!.name} {iouWords(iouPreview.before)}</div>
              <div className="font-medium">After: {person!.name} {iouWords(iouPreview.after)}</div>
            </div>
          )}
        </Field>
      )}

      {noAccounts ? (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm">You need an account first. <Link className="text-accent underline" href="/more/accounts">Add an account</Link>.</p>
      ) : (
        <div className={cx("grid gap-4", type === "transfer" && "sm:grid-cols-2")}>
          <Field label={type === "transfer" ? "From account" : ["income", "borrow", "repayment_received"].includes(type) ? "Into account" : "From account"} htmlFor="accountId" error={errors.accountId}>
            <Select id="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} error={errors.accountId}>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({formatINR(BigInt(a.balancePaise))})</option>
              ))}
            </Select>
          </Field>
          {type === "transfer" && (
            <Field label="To account" htmlFor="toAccountId" error={errors.toAccountId}>
              <Select id="toAccountId" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} error={errors.toAccountId}>
                <option value="">Choose…</option>
                {data.accounts.filter((a) => a.id !== accountId).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="date" error={errors.date}>
          <TextInput id="date" type="date" value={date} max={data.today} onChange={(e) => setDate(e.target.value)} error={errors.date} />
        </Field>
        {type !== "transfer" && (
          <Field label="Paid via" htmlFor="paymentMethod" hint="Optional">
            <Select id="paymentMethod" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <Field label="Note" htmlFor="note" hint="Optional" error={errors.note}>
        <TextInput id="note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. lunch with team" error={errors.note} />
      </Field>

      {/* Sticky so the Save button stays reachable above the bottom nav and keyboard. */}
      <div className="sticky bottom-20 z-10 -mx-4 space-y-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <StatusText status={status} />
        <div className="flex gap-2">
          <Button type="submit" size="lg" className="flex-1" pending={pending} disabled={noAccounts}>
            {editing ? "Save changes" : "Save"}
          </Button>
          {editing && (
            <Button type="button" variant="danger" size="lg" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title="Check who owes whom"
        confirmLabel="Save anyway"
        onCancel={() => setConfirm(null)}
        onConfirm={() => submit(true)}
        pending={pending}
      >
        <p>{confirm?.message}</p>
        {iouPreview && (
          <p className="mt-2 text-sm text-muted">
            Before: {iouWords(iouPreview.before)}. After: {iouWords(iouPreview.after)}.
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={confirmDelete} title="Delete this entry?" confirmLabel="Delete" danger onCancel={() => setConfirmDelete(false)} onConfirm={doDelete} pending={pending}>
        All balances and budgets will be recalculated. This cannot be undone.
      </ConfirmDialog>
    </form>
  );
}
