"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { archivePersonAction, createPersonAction, deletePersonAction, updatePersonAction } from "@/app/actions/ledger";
import { Button, ConfirmDialog, Field, Select, StatusText, TextInput } from "./client";
import { paiseToInput, parseRupees } from "@/lib/money";

type Person = { id: string; name: string; label: string | null; openingIouPaise: string; openingDate: string; version: number; archived: boolean };

export function PersonForm({ today, person, onDone }: { today: string; person?: Person; onDone?: () => void }) {
  const router = useRouter();
  const opening = person ? BigInt(person.openingIouPaise) : 0n;
  const [name, setName] = useState(person?.name ?? "");
  const [label, setLabel] = useState(person?.label ?? "");
  const [direction, setDirection] = useState<"owes_me" | "i_owe">(opening < 0n ? "i_owe" : "owes_me");
  const [amount, setAmount] = useState(opening === 0n ? "" : paiseToInput(opening < 0n ? -opening : opening));
  const [openingDate, setOpeningDate] = useState(person?.openingDate ?? today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  function signedOpening(): string {
    const a = amount.trim();
    if (a === "" || a === "0") return "0";
    return direction === "i_owe" ? `-${a}` : a;
  }

  function save(confirmOpeningChange = false) {
    if (busy.current) return;
    if (amount.trim()) {
      const p = parseRupees(amount, { allowZero: true });
      if (!p.ok) return setErrors({ openingIou: p.error });
    }
    busy.current = true;
    start(async () => {
      try {
        const payload = { name, label, openingIou: signedOpening(), openingDate };
        const res = person
          ? await updatePersonAction({ ...payload, id: person.id, version: person.version, confirmOpeningChange })
          : await createPersonAction(payload);
        if (res.ok) {
          setConfirmMsg(null);
          setStatus({ tone: "ok", text: "Saved." });
          if (!person) {
            setName("");
            setLabel("");
            setAmount("");
          }
          onDone?.();
        } else if (res.code === "needs_confirmation") setConfirmMsg(res.message);
        else {
          setErrors(res.fieldErrors ?? {});
          setStatus({ tone: "error", text: `Not saved. ${res.message}` });
        }
      } catch {
        setStatus({ tone: "error", text: "Not saved: could not reach the server." });
      } finally {
        busy.current = false;
      }
    });
  }

  function archive() {
    if (!person) return;
    start(async () => {
      const r = await archivePersonAction(person.id, !person.archived);
      setStatus(r.ok ? { tone: "ok", text: person.archived ? "Unarchived." : "Archived. History is kept." } : { tone: "error", text: r.message });
    });
  }
  function remove() {
    if (!person) return;
    start(async () => {
      const r = await deletePersonAction(person.id);
      setConfirmDelete(false);
      if (r.ok) router.push("/");
      else setStatus({ tone: "error", text: r.message });
    });
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Field label="Name" htmlFor="p-name" error={errors.name}>
        <TextInput id="p-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} error={errors.name} autoComplete="off" />
      </Field>
      <Field label="Label" htmlFor="p-label" hint="Optional, to tell people with the same name apart (e.g. “college”)." error={errors.label}>
        <TextInput id="p-label" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} error={errors.label} autoComplete="off" />
      </Field>
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium">Balance before using this app (optional)</legend>
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label="Who owes whom" value={direction} onChange={(e) => setDirection(e.target.value as "owes_me" | "i_owe")}>
            <option value="owes_me">They owe me</option>
            <option value="i_owe">I owe them</option>
          </Select>
          <TextInput aria-label="Opening amount in rupees" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.openingIou} />
        </div>
        {errors.openingIou && <p className="text-sm text-danger" role="alert">{errors.openingIou}</p>}
        <p className="text-xs text-muted">This is a starting balance, not a new loan. It does not change any account.</p>
      </fieldset>
      <Field label="As of date" htmlFor="p-date" error={errors.openingDate} hint="Entries before this date are not allowed for this person.">
        <TextInput id="p-date" type="date" max={today} value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} error={errors.openingDate} />
      </Field>
      <StatusText status={status} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" pending={pending} className="flex-1">{person ? "Save changes" : "Add person"}</Button>
        {person && (
          <>
            <Button type="button" variant="secondary" onClick={archive}>{person.archived ? "Unarchive" : "Archive"}</Button>
            <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </>
        )}
      </div>
      <ConfirmDialog open={!!confirmMsg} title="Change opening balance?" confirmLabel="Change it" onCancel={() => setConfirmMsg(null)} onConfirm={() => save(true)} pending={pending}>
        {confirmMsg}
      </ConfirmDialog>
      <ConfirmDialog open={confirmDelete} title="Delete this person?" confirmLabel="Delete" danger onCancel={() => setConfirmDelete(false)} onConfirm={remove} pending={pending}>
        Only people with no entries can be deleted. Otherwise archive them to keep the history.
      </ConfirmDialog>
    </form>
  );
}
