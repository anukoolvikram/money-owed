"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { removePersonAction } from "@/app/actions/ledger";
import { ConfirmDialog } from "./client";
import { useFresh } from "./fresh-data";

/** Trash button that removes a person and all their transactions after confirming. */
export function RemovePerson({ id, name, redirectTo }: { id: string; name: string; redirectTo?: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fresh = useFresh();

  function remove() {
    const shown = fresh.begin();
    start(async () => {
      try {
        const res = await removePersonAction(id);
        if (!res.ok) return setError(res.message);
        if (redirectTo) return router.push(redirectTo);
        await shown();
        setConfirm(false);
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Remove ${name}`}
        title="Remove"
        onClick={() => {
          setError(null);
          setConfirm(true);
        }}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-danger"
      >
        <Trash2 size={17} aria-hidden />
      </button>
      <ConfirmDialog open={confirm} title={`Remove ${name}?`} confirmLabel="Remove" danger pending={pending} pendingLabel="Removing…" onCancel={() => setConfirm(false)} onConfirm={remove}>
        <p>All of their transactions will be deleted too.</p>
        {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
