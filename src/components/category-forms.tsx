"use client";
import { useState, useTransition } from "react";
import { archiveCategoryAction, createCategoryAction, deleteCategoryAction, renameCategoryAction } from "@/app/actions/ledger";
import { Button, Select, StatusText, TextInput } from "./client";

export function AddCategoryForm() {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="space-y-2" noValidate onSubmit={(e) => { e.preventDefault(); start(async () => {
      const r = await createCategoryAction({ name, kind });
      setStatus(r.ok ? { tone: "ok", text: "Added." } : { tone: "error", text: r.fieldErrors?.name ?? r.message });
      if (r.ok) setName("");
    }); }}>
      <div className="flex gap-2">
        <label htmlFor="c-name" className="sr-only">Category name</label>
        <TextInput id="c-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="New category" className="flex-1" />
        <label htmlFor="c-kind" className="sr-only">Kind</label>
        <Select id="c-kind" value={kind} onChange={(e) => setKind(e.target.value as "expense" | "income")} className="w-32">
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </Select>
      </div>
      <Button type="submit" pending={pending} className="w-full">Add category</Button>
      <StatusText status={status} />
    </form>
  );
}

export function CategoryRow({ c }: { c: { id: string; name: string; archived: boolean } }) {
  const [name, setName] = useState(c.name);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; fieldErrors?: Record<string, string> }>, ok: string) =>
    start(async () => {
      const r = await fn();
      setStatus(r.ok ? { tone: "ok", text: ok } : { tone: "error", text: r.fieldErrors?.name ?? r.message ?? "Failed." });
    });
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`cat-${c.id}`} className="sr-only">Name</label>
        <TextInput id={`cat-${c.id}`} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1" />
        {name !== c.name && <Button variant="secondary" pending={pending} onClick={() => run(() => renameCategoryAction({ id: c.id, name }), "Renamed.")}>Save</Button>}
        <Button variant="ghost" onClick={() => run(() => archiveCategoryAction(c.id, !c.archived), c.archived ? "Restored." : "Archived.")}>{c.archived ? "Restore" : "Archive"}</Button>
        <Button variant="ghost" className="text-danger" onClick={() => run(() => deleteCategoryAction(c.id), "Deleted.")}>Delete</Button>
      </div>
      <StatusText status={status} />
    </li>
  );
}
