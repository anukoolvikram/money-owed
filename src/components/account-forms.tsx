"use client";
import { useRef, useState, useTransition } from "react";
import { archiveAccountAction, createAccountAction, deleteAccountAction, updateAccountAction } from "@/app/actions/ledger";
import { Button, ConfirmDialog, Field, Select, StatusText, TextInput } from "./client";
import { paiseToInput } from "@/lib/money";

type Account = { id: string; name: string; kind: "cash" | "bank" | "wallet"; openingBalancePaise: string; openingDate: string; version: number; archived: boolean };

export function AccountForm({ today, account }: { today: string; account?: Account }) {
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<Account["kind"]>(account?.kind ?? "bank");
  const [openingBalance, setOpeningBalance] = useState(account ? paiseToInput(BigInt(account.openingBalancePaise)) : "");
  const [openingDate, setOpeningDate] = useState(account?.openingDate ?? today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  function save(confirmOpeningChange = false) {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        const payload = { name, kind, openingBalance: openingBalance.trim() || "0", openingDate };
        const r = account
          ? await updateAccountAction({ ...payload, id: account.id, version: account.version, confirmOpeningChange })
          : await createAccountAction(payload);
        if (r.ok) {
          setConfirmMsg(null);
          setErrors({});
          setStatus({ tone: "ok", text: "Saved." });
          if (!account) { setName(""); setOpeningBalance(""); }
        } else if (r.code === "needs_confirmation") setConfirmMsg(r.message);
        else { setErrors(r.fieldErrors ?? {}); setStatus({ tone: "error", text: `Not saved. ${r.message}` }); }
      } catch {
        setStatus({ tone: "error", text: "Not saved: could not reach the server." });
      } finally {
        busy.current = false;
      }
    });
  }

  const p = account?.id ?? "new";
  return (
    <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <Field label="Name" htmlFor={`a-name-${p}`} error={errors.name}>
            <TextInput id={`a-name-${p}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="e.g. Savings account" autoComplete="off" />
          </Field>
        </div>
        <Field label="Type" htmlFor={`a-kind-${p}`}>
          <Select id={`a-kind-${p}`} value={kind} onChange={(e) => setKind(e.target.value as Account["kind"])}>
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
            <option value="wallet">Wallet</option>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Opening balance (₹)" htmlFor={`a-open-${p}`} error={errors.openingBalance} hint="Use − for overdrawn.">
          <TextInput id={`a-open-${p}`} inputMode="decimal" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="0" error={errors.openingBalance} />
        </Field>
        <Field label="As of" htmlFor={`a-date-${p}`} error={errors.openingDate}>
          <TextInput id={`a-date-${p}`} type="date" max={today} value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} error={errors.openingDate} />
        </Field>
      </div>
      <p className="text-xs text-muted">The opening balance is what the account held on that date. It is not income.</p>
      <StatusText status={status} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" pending={pending} className="flex-1">{account ? "Save" : "Add account"}</Button>
        {account && (
          <>
            <Button type="button" variant="secondary" onClick={() => start(async () => {
              const r = await archiveAccountAction(account.id, !account.archived);
              setStatus(r.ok ? { tone: "ok", text: account.archived ? "Unarchived." : "Archived. History is kept." } : { tone: "error", text: r.message });
            })}>{account.archived ? "Unarchive" : "Archive"}</Button>
            <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </>
        )}
      </div>
      <ConfirmDialog open={!!confirmMsg} title="Change opening balance?" confirmLabel="Change it" onCancel={() => setConfirmMsg(null)} onConfirm={() => save(true)} pending={pending}>{confirmMsg}</ConfirmDialog>
      <ConfirmDialog open={confirmDelete} title="Delete this account?" confirmLabel="Delete" danger onCancel={() => setConfirmDelete(false)} pending={pending}
        onConfirm={() => start(async () => {
          const r = await deleteAccountAction(account!.id);
          setConfirmDelete(false);
          setStatus(r.ok ? { tone: "ok", text: "Deleted." } : { tone: "error", text: r.message });
        })}>
        Only accounts with no entries can be deleted. Otherwise, archive it.
      </ConfirmDialog>
    </form>
  );
}
