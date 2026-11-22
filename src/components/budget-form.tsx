"use client";
import { useState, useTransition } from "react";
import { setBudgetAction } from "@/app/actions/ledger";
import { Button, Field, StatusText, TextInput } from "./client";
import { paiseToInput } from "@/lib/money";

export function BudgetForm({ periodStart, overall, categories }: { periodStart: string; overall: string | null; categories: { categoryId: string; name: string; limitPaise: string | null }[] }) {
  const [o, setO] = useState(overall ? paiseToInput(BigInt(overall)) : "");
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(categories.map((c) => [c.categoryId, c.limitPaise ? paiseToInput(BigInt(c.limitPaise)) : ""])),
  );
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); start(async () => {
      try {
        const r = await setBudgetAction({ periodStart, overall: o, categoryLimits: categories.map((c) => ({ categoryId: c.categoryId, limit: limits[c.categoryId] ?? "" })) });
        setErrors(r.ok ? {} : r.fieldErrors ?? {});
        setStatus(r.ok ? { tone: "ok", text: "Budget saved for this cycle only." } : { tone: "error", text: `Not saved. ${r.message}` });
      } catch { setStatus({ tone: "error", text: "Not saved: could not reach the server." }); }
    }); }}>
      <Field label="Overall spending limit (₹)" htmlFor="b-overall" hint="Leave empty for “Not set”." error={errors.overall}>
        <TextInput id="b-overall" inputMode="decimal" value={o} onChange={(e) => setO(e.target.value)} error={errors.overall} />
      </Field>
      <fieldset className="min-w-0">
        <legend className="text-sm font-medium">Category limits (optional)</legend>
        <p className="mb-2 text-xs text-muted">These are a closer look at the same spending, not extra money on top of the overall limit.</p>
        <div className="grid grid-cols-2 gap-2">
          {categories.map((c, i) => (
            <div key={c.categoryId}>
              <label htmlFor={`b-cat-${c.categoryId}`} className="block truncate text-sm">{c.name}</label>
              <TextInput id={`b-cat-${c.categoryId}`} inputMode="decimal" value={limits[c.categoryId] ?? ""} placeholder="Not set"
                onChange={(e) => setLimits({ ...limits, [c.categoryId]: e.target.value })} error={errors[`categoryLimits.${i}.limit`]} />
              {errors[`categoryLimits.${i}.limit`] && <p className="text-xs text-danger">{errors[`categoryLimits.${i}.limit`]}</p>}
            </div>
          ))}
        </div>
      </fieldset>
      <StatusText status={status} />
      <Button type="submit" pending={pending} className="w-full">Save budget</Button>
    </form>
  );
}
