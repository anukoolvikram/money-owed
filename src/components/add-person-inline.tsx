"use client";
import { useState, useTransition } from "react";
import { createPersonAction } from "@/app/actions/ledger";
import { Button, TextInput } from "./client";
import { useFresh } from "./fresh-data";

export function AddPersonInline({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fresh = useFresh();

  if (!open)
    return (
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        + Add person
      </Button>
    );

  function save() {
    if (!name.trim()) return setError("Enter a name.");
    const shown = fresh.begin();
    start(async () => {
      try {
        const res = await createPersonAction({ name, label: "", openingIou: "0", openingDate: today });
        if (res.ok) {
          await shown();
          setName("");
          setError(null);
          setOpen(false);
        } else setError(res.fieldErrors?.name ?? res.message);
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  }

  return (
    <form
      noValidate
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex gap-2">
        <TextInput id="new-person" aria-label="Name" placeholder="Name" autoFocus maxLength={60} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} error={error ?? undefined} className="flex-1" />
        <Button type="submit" pending={pending} pendingLabel="Adding…">Add</Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
      </div>
      {error && <p id="new-person-error" className="text-sm text-danger" role="alert">{error}</p>}
    </form>
  );
}
