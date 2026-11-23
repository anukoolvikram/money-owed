"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { quickIouAction, updateQuickIouAction } from "@/app/actions/ledger";
import { Button, Field, inputClass, Select, StatusText, TextInput } from "./client";
import { cx } from "./ui";
import { useFresh } from "./fresh-data";
import { formatINR, parseRupees } from "@/lib/money";

type Person = { id: string; name: string; label: string | null };
type Kind = "lend" | "borrow";
export type EditingIou = { id: string; version: number; type: Kind; amount: string; date: string; note: string; personId: string; back: string };

const NEW = "__new__";

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `iou-${crypto.randomUUID()}` : `iou-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const kindStyle: Record<Kind, { on: string; off: string }> = {
  lend: { on: "border-in bg-in text-bg", off: "border-in text-in hover:bg-surface-2" },
  borrow: { on: "border-out bg-out text-bg", off: "border-out text-out hover:bg-surface-2" },
};

/**
 * Lend / Borrow buttons and the form they open.
 * - fixedPerson: used on a person's page, so no person picker is shown.
 * - editing: edits an existing entry (form is always open).
 */
export function QuickIou({ today, people, fixedPerson, editing }: { today: string; people: Person[]; fixedPerson?: { id: string; name: string }; editing?: EditingIou }) {
  const router = useRouter();
  const fresh = useFresh();
  const defaultPerson = editing?.personId ?? fixedPerson?.id ?? (people.length ? "" : NEW);
  const [kind, setKind] = useState<Kind | null>(editing?.type ?? null);
  const [amount, setAmount] = useState(editing?.amount ?? "");
  const [personId, setPersonId] = useState(defaultPerson);
  const [newName, setNewName] = useState("");
  const [note, setNote] = useState(editing?.note ?? "");
  const [date, setDate] = useState(editing?.date ?? today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const keyRef = useRef(newKey());
  const inFlight = useRef(false);

  function reset() {
    if (editing) return router.push(editing.back);
    setKind(null);
    setAmount("");
    setPersonId(fixedPerson?.id ?? (people.length ? "" : NEW));
    setNewName("");
    setNote("");
    setDate(today);
    setErrors({});
    keyRef.current = newKey();
  }

  function submit() {
    if (!kind || inFlight.current) return;
    const parsed = parseRupees(amount);
    const e: Record<string, string> = {};
    if (!parsed.ok) e.amount = parsed.error;
    if (!personId) e.personId = "Choose a person.";
    if (personId === NEW && !newName.trim()) e.newPersonName = "Enter a name.";
    if (date > today) e.date = "Future dates are not allowed.";
    setErrors(e);
    if (Object.keys(e).length) return;

    const who = personId === NEW ? newName.trim() : (fixedPerson?.name ?? people.find((p) => p.id === personId)?.name ?? "");
    inFlight.current = true;
    setStatus(null);
    const shown = fresh.begin();
    start(async () => {
      try {
        const res = editing
          ? await updateQuickIouAction({ id: editing.id, version: editing.version, type: kind, amount, date, note, personId })
          : await quickIouAction({
              type: kind,
              amount,
              date,
              note,
              personId: personId === NEW ? undefined : personId,
              newPersonName: personId === NEW ? newName : undefined,
              idempotencyKey: keyRef.current,
            });
        if (res.ok) {
          if (editing) return router.push(editing.back);
          await shown(); // keep spinning until the page shows the new entry
          const amt = parsed.ok ? formatINR(parsed.paise) : "";
          reset();
          setStatus({ tone: "ok", text: kind === "lend" ? `Lent ${amt} to ${who}` : `Borrowed ${amt} from ${who}` });
        } else if (res.code === "unauthorized") {
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
        } else {
          setErrors(res.fieldErrors ?? {});
          setStatus({ tone: "error", text: res.message });
        }
      } catch {
        setStatus({ tone: "error", text: "Could not reach the server. Try again." });
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Entry type">
        {(["lend", "borrow"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => {
              setKind(k);
              setStatus(null);
              setErrors({});
            }}
            className={cx("min-h-14 rounded-2xl border-2 text-lg font-semibold transition-colors", kind === k ? kindStyle[k].on : kindStyle[k].off)}
          >
            {k === "lend" ? "Lend" : "Borrow"}
          </button>
        ))}
      </div>

      {kind && (
        <form
          noValidate
          className="mt-3 space-y-4 rounded-2xl border border-line bg-surface p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Amount" htmlFor="qi-amount" error={errors.amount}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-muted" aria-hidden>₹</span>
              <input
                id="qi-amount"
                inputMode="decimal"
                autoComplete="off"
                autoFocus={!editing}
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={errors.amount ? true : undefined}
                aria-describedby={errors.amount ? "qi-amount-error" : undefined}
                className={cx(inputClass, "num h-14 pl-8 text-2xl font-semibold")}
              />
            </div>
          </Field>

          {!fixedPerson && (
            <>
              {(people.length > 0 || editing) && (
                <Field label="Person" htmlFor="qi-person" error={errors.personId}>
                  <Select id="qi-person" value={personId} onChange={(e) => setPersonId(e.target.value)} error={errors.personId}>
                    <option value="" disabled>Choose a person…</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>{p.label ? `${p.name} (${p.label})` : p.name}</option>
                    ))}
                    {!editing && <option value={NEW}>+ Add new person</option>}
                  </Select>
                </Field>
              )}
              {personId === NEW && (
                <Field label={people.length ? "New person" : "Person"} htmlFor="qi-new" error={errors.newPersonName}>
                  <TextInput id="qi-new" value={newName} maxLength={60} autoComplete="off" placeholder="Name" onChange={(e) => setNewName(e.target.value)} error={errors.newPersonName} />
                </Field>
              )}
            </>
          )}

          <Field label="Reason" htmlFor="qi-note" error={errors.note}>
            <TextInput id="qi-note" value={note} maxLength={500} placeholder="Optional" onChange={(e) => setNote(e.target.value)} error={errors.note} />
          </Field>

          <Field label="Date" htmlFor="qi-date" error={errors.date}>
            <TextInput id="qi-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} error={errors.date} />
          </Field>

          <StatusText status={status?.tone === "error" ? status : null} />
          <div className="flex gap-2">
            <Button type="submit" size="lg" className="flex-1" pending={pending}>Submit</Button>
            <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={reset} disabled={pending}>Cancel</Button>
          </div>
        </form>
      )}
      {!kind && status?.tone === "ok" && <p className="mt-2 px-1 text-sm text-muted" role="status">{status.text}</p>}
    </div>
  );
}
