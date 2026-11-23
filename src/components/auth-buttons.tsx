"use client";
import { useState } from "react";
import { Button, ConfirmDialog } from "./client";

async function post(path: string, body: unknown = {}) {
  return fetch(`/api/auth${path}`, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
}

/** Signs out server-side, then hard-navigates so no private client state survives. */
export function LogoutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="secondary"
      className={className}
      pending={pending}
      pendingLabel="Signing out…"
      onClick={async () => {
        setPending(true);
        try {
          await post("/sign-out");
        } finally {
          window.location.replace("/login");
        }
      }}
    >
      Log out
    </Button>
  );
}

export function RevokeAllButton() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>Sign out everywhere</Button>
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ConfirmDialog
        open={open}
        title="Sign out on all devices?"
        confirmLabel="Sign out everywhere"
        danger
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setPending(true);
          try {
            const r = await post("/revoke-sessions");
            if (!r.ok) throw new Error();
            window.location.replace("/login");
          } catch {
            setError("Could not reach the server. Nothing changed.");
            setPending(false);
            setOpen(false);
          }
        }}
      >
        Every session, including this one, will be ended. You will need your password to sign in again.
      </ConfirmDialog>
    </>
  );
}
