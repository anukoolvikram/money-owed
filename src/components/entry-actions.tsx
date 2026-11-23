"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { deleteTransactionAction } from "@/app/actions/ledger";
import { ConfirmDialog } from "./client";
import { useFresh } from "./fresh-data";

const iconBtn = "inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink";

/** Edit / Delete buttons shown beside one entry. */
export function EntryActions({ id, version, label }: { id: string; version: number; label: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fresh = useFresh();

  function remove() {
    const shown = fresh.begin();
    start(async () => {
      try {
        const res = await deleteTransactionAction({ id, version });
        if (!res.ok) return setError(res.message);
        await shown(); // keep spinning until the entry is gone from the page
        setConfirm(false);
      } catch {
        setError("Not deleted: could not reach the server.");
      }
    });
  }

  return (
    <span className="flex shrink-0 items-center">
      <Link href={`/transactions/${id}`} className={iconBtn} aria-label={`Edit ${label}`} title="Edit">
        <Pencil size={17} aria-hidden />
      </Link>
      <button
        type="button"
        className={`${iconBtn} hover:text-danger`}
        aria-label={`Delete ${label}`}
        title="Delete"
        onClick={() => {
          setError(null);
          setConfirm(true);
        }}
      >
        <Trash2 size={17} aria-hidden />
      </button>
      <ConfirmDialog
        open={confirm}
        title="Delete this entry?"
        confirmLabel="Delete"
        danger
        pending={pending} pendingLabel="Deleting…"
        onCancel={() => setConfirm(false)}
        onConfirm={remove}
      >
        <p>{label}</p>
        {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
      </ConfirmDialog>
    </span>
  );
}
