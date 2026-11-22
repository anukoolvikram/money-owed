"use client";
import { useState } from "react";
import { Button, Field, TextInput } from "@/components/client";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      // The real, throttled public sign-in route. No server-side proxy.
      const res = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: fd.get("email"), password: fd.get("password"), rememberMe: true }),
      });
      if (res.ok) {
        window.location.replace("/");
        return;
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get("x-retry-after") ?? "");
        setError(`Too many attempts. Please wait${wait > 0 ? ` ${Math.ceil(wait / 60)} minute${wait > 60 ? "s" : ""}` : " a little"} and try again.`);
      } else {
        setError("Email or passphrase is incorrect.");
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="email">
        <TextInput id="email" name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required />
      </Field>
      <Field label="Passphrase" htmlFor="password">
        <TextInput id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
      </Field>
      {error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" pending={pending}>
        Sign in
      </Button>
    </form>
  );
}
