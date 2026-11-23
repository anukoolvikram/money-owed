import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOwner } from "@/server/auth/guard";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getOwner()) redirect("/");
  return (
    <main className="safe-top mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8">
        <div aria-hidden className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-2xl font-bold text-accent-ink">₹</div>
        <h1 className="text-2xl font-semibold">Personal Ledger</h1>
        <p className="mt-1 text-muted">Private. Sign in to continue.</p>
      </div>
      <LoginForm />
    </main>
  );
}
