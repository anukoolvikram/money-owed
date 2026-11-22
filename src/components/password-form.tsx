"use client";
import { useState } from "react";
import { Button, Field, StatusText, TextInput } from "./client";

export function ChangePasswordForm() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form className="space-y-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      if (next !== again) return setStatus({ tone: "error", text: "The new passphrases do not match." });
      if ([...next].length < 15) return setStatus({ tone: "error", text: "Use at least 15 characters." });
      setPending(true);
      try {
        const r = await fetch("/api/auth/change-password", {
          method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
          body: JSON.stringify({ currentPassword: cur, newPassword: next, revokeOtherSessions: true }),
        });
        if (r.ok) {
          setStatus({ tone: "ok", text: "Passphrase changed. Other devices were signed out." });
          setCur(""); setNext(""); setAgain("");
        } else {
          const body = await r.json().catch(() => ({}));
          setStatus({ tone: "error", text: r.status === 400 && body?.message ? body.message : r.status === 429 ? "Too many attempts. Try later." : "Current passphrase is incorrect." });
        }
      } catch {
        setStatus({ tone: "error", text: "Could not reach the server. Nothing changed." });
      }
      setPending(false);
    }}>
      <input type="text" name="username" autoComplete="username" hidden readOnly />
      <Field label="Current passphrase" htmlFor="pw-cur"><TextInput id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
      <Field label="New passphrase" htmlFor="pw-new" hint="15–128 characters. Spaces are fine; a few unrelated words works well."><TextInput id="pw-new" type="password" autoComplete="new-password" maxLength={128} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Repeat new passphrase" htmlFor="pw-again"><TextInput id="pw-again" type="password" autoComplete="new-password" maxLength={128} value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
      <StatusText status={status} />
      <Button type="submit" pending={pending} className="w-full">Change passphrase</Button>
    </form>
  );
}
