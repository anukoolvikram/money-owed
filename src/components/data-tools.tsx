"use client";
import { useState, useTransition } from "react";
import { commitCsvAction, commitRestoreAction, previewCsvAction, previewRestoreAction } from "@/app/actions/data";
import { Button, ConfirmDialog, Field, Select, StatusText } from "./client";
import { cx } from "./ui";

type Status = { tone: "ok" | "error"; text: string } | null;
const MAX_BYTES = 1_500_000;

async function readFile(input: HTMLInputElement, max: number): Promise<{ text?: string; error?: string }> {
  const f = input.files?.[0];
  if (!f) return { error: "Choose a file first." };
  if (f.size > max) return { error: `The file is larger than ${(max / 1_000_000).toFixed(1)} MB.` };
  return { text: await f.text() };
}

export function RestoreTool() {
  const [text, setText] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ ok: boolean; errors: string[]; counts: Record<string, number> } | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <Field label="Backup file (.json)" htmlFor="restore-file" hint="Restore works only into an empty ledger. Nothing is merged or overwritten.">
        <input id="restore-file" type="file" accept="application/json,.json" className="block w-full text-sm"
          onChange={(e) => { const el = e.currentTarget; setPreview(null); setStatus(null); start(async () => {
            const r = await readFile(el, MAX_BYTES);
            if (r.error) return setStatus({ tone: "error", text: r.error });
            setText(r.text!);
            const res = await previewRestoreAction(r.text!);
            if (res.ok) setPreview(res.data); else setStatus({ tone: "error", text: res.message });
          }); }} />
      </Field>
      {pending && !preview && <p className="text-sm text-muted">Checking file…</p>}
      {preview && (
        <div className={cx("rounded-xl border p-3 text-sm", preview.ok ? "border-line" : "border-danger/40 bg-danger-soft")}>
          <p className="font-medium">Dry run: {preview.ok ? "ready to restore" : "cannot restore"}</p>
          <p className="text-muted">{preview.counts.accounts} accounts · {preview.counts.categories} categories · {preview.counts.people} people · {preview.counts.transactions} entries · {preview.counts.budgets} budgets</p>
          {preview.errors.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{preview.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
      {preview?.ok && <Button onClick={() => setConfirm(true)} className="w-full">Restore this backup</Button>}
      <StatusText status={status} />
      <ConfirmDialog open={confirm} title="Restore backup?" confirmLabel="Restore" pending={pending} onCancel={() => setConfirm(false)}
        onConfirm={() => start(async () => {
          try {
            const r = await commitRestoreAction(text);
            setConfirm(false);
            if (r.ok) { setPreview(null); setStatus({ tone: "ok", text: `Restored ${r.data.transactions} entries.` }); }
            else setStatus({ tone: "error", text: `${r.message}${r.details?.errors ? " " + r.details.errors : ""}` });
          } catch { setConfirm(false); setStatus({ tone: "error", text: "Could not reach the server. Nothing was restored." }); }
        })}>
        All records in the file will be added to your empty ledger in one step. If anything fails, nothing is saved.
      </ConfirmDialog>
    </div>
  );
}

type Row = { line: number; date: string; type: string; amount: string; account: string; person: string; category: string; note: string; errors: string[]; warnings: string[] };
type CsvPreview = { ok: boolean; fileError?: string; rows: Row[]; errorCount: number; warningCount: number; newPeople: string[]; headers: string[]; alreadyImported: boolean; totalRows: number };

export function CsvImportTool({ accounts, expenseCategories, incomeCategories }: { accounts: string[]; expenseCategories: string[]; incomeCategories: string[] }) {
  const [text, setText] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mode, setMode] = useState<"template" | "sheet">("template");
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [cols, setCols] = useState({ date: "", person: "", moneyOut: "", moneyIn: "", note: "" });
  const [accountName, setAccountName] = useState(accounts[0] ?? "");
  const [outType, setOutType] = useState("lend");
  const [inType, setInType] = useState("repayment_received");
  const [outCategory, setOutCategory] = useState(expenseCategories[0] ?? "");
  const [inCategory, setInCategory] = useState(incomeCategories[0] ?? "");
  const [createMissingPeople, setCreate] = useState(false);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  const options = () =>
    mode === "template"
      ? { mode, dateFormat }
      : { mode, dateFormat, columns: Object.fromEntries(Object.entries(cols).filter(([, v]) => v)), accountName, outType, inType, outCategory, inCategory, createMissingPeople };

  const runPreview = () => start(async () => {
    if (!text) return;
    try {
      const r = await previewCsvAction(text, options());
      if (r.ok) { setPreview(r.data); setHeaders(r.data.headers); } else setStatus({ tone: "error", text: r.message });
    } catch { setStatus({ tone: "error", text: "Could not reach the server." }); }
  });

  const colSelect = (key: keyof typeof cols, label: string) => (
    <Field label={label} htmlFor={`col-${key}`}>
      <Select id={`col-${key}`} value={cols[key]} onChange={(e) => setCols({ ...cols, [key]: e.target.value })}>
        <option value="">— not used —</option>
        {headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-3">
      <Field label="CSV file" htmlFor="csv-file" hint="Up to 1 MB and 5,000 rows. Accounts and categories must already exist.">
        <input id="csv-file" type="file" accept=".csv,text/csv" className="block w-full text-sm"
          onChange={(e) => { const el = e.currentTarget; setPreview(null); setStatus(null); start(async () => {
            const r = await readFile(el, 1_000_000);
            if (r.error) return setStatus({ tone: "error", text: r.error });
            setText(r.text!);
            const first = r.text!.replace(/^﻿/, "").split(/\r?\n/)[0] ?? "";
            const hs = first.split(",").map((h) => h.replace(/^"|"$/g, "").trim()).filter(Boolean);
            setHeaders(hs);
            const lower = hs.map((h) => h.toLowerCase());
            const isTemplate = ["date", "type", "amount", "account"].every((h) => lower.includes(h));
            setMode(isTemplate ? "template" : "sheet");
            if (!isTemplate) {
              const find = (re: RegExp) => hs.find((h) => re.test(h)) ?? "";
              setCols({ date: find(/date/i), person: find(/person|name/i), moneyOut: find(/out|paid|debit/i), moneyIn: find(/\bin\b|received|credit/i), note: find(/note|remark|desc/i) });
              setDateFormat("DD/MM/YYYY");
            }
          }); }} />
      </Field>
      {text && (
        <>
          <Field label="File format" htmlFor="csv-mode">
            <Select id="csv-mode" value={mode} onChange={(e) => { setMode(e.target.value as "template" | "sheet"); setPreview(null); }}>
              <option value="template">This app’s template (has a type column)</option>
              <option value="sheet">My own sheet (map columns)</option>
            </Select>
          </Field>
          <Field label="Date format in the file" htmlFor="csv-date">
            <Select id="csv-date" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
              <option value="YYYY-MM-DD">2026-01-31</option>
              <option value="DD/MM/YYYY">31/01/2026 (day first)</option>
              <option value="MM/DD/YYYY">01/31/2026 (month first)</option>
            </Select>
          </Field>
          {mode === "sheet" && (
            <div className="space-y-3 rounded-xl border border-line p-3">
              <p className="text-sm text-muted">A money direction alone cannot tell a loan from a repayment, so choose what each direction means. Every row is shown in the preview before anything is saved.</p>
              <div className="grid grid-cols-2 gap-2">
                {colSelect("date", "Date column")}
                {colSelect("person", "Person column")}
                {colSelect("moneyOut", "Money out column")}
                {colSelect("moneyIn", "Money in column")}
                {colSelect("note", "Note column")}
                <Field label="Account used" htmlFor="csv-acc">
                  <Select id="csv-acc" value={accountName} onChange={(e) => setAccountName(e.target.value)}>
                    {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Money out means" htmlFor="csv-out">
                <Select id="csv-out" value={outType} onChange={(e) => setOutType(e.target.value)}>
                  <option value="lend">I lent to the person</option>
                  <option value="repayment_paid">I repaid the person</option>
                  <option value="expense">An expense</option>
                </Select>
              </Field>
              {outType === "expense" && (
                <Select aria-label="Expense category" value={outCategory} onChange={(e) => setOutCategory(e.target.value)}>
                  {expenseCategories.map((c) => <option key={c}>{c}</option>)}
                </Select>
              )}
              <Field label="Money in means" htmlFor="csv-in">
                <Select id="csv-in" value={inType} onChange={(e) => setInType(e.target.value)}>
                  <option value="repayment_received">The person repaid me</option>
                  <option value="borrow">I borrowed from the person</option>
                  <option value="income">Income</option>
                </Select>
              </Field>
              {inType === "income" && (
                <Select aria-label="Income category" value={inCategory} onChange={(e) => setInCategory(e.target.value)}>
                  {incomeCategories.map((c) => <option key={c}>{c}</option>)}
                </Select>
              )}
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={createMissingPeople} onChange={(e) => setCreate(e.target.checked)} className="h-5 w-5" />
                Create people that don’t exist yet (each new name becomes a separate person)
              </label>
            </div>
          )}
          <Button variant="secondary" onClick={runPreview} pending={pending} className="w-full">Check file (dry run)</Button>
        </>
      )}
      {preview && (
        <div className="space-y-2">
          <div className={cx("rounded-xl border p-3 text-sm", preview.ok ? "border-line" : "border-danger/40 bg-danger-soft")}>
            {preview.fileError ? <p className="font-medium">{preview.fileError}</p> : (
              <>
                <p className="font-medium">{preview.totalRows} rows · {preview.errorCount} errors · {preview.warningCount} warnings</p>
                {preview.alreadyImported && <p>This exact file was already imported with these options.</p>}
                {preview.errorCount > 0 && <p>Fix every error in the file, then check again. Rows are never skipped silently.</p>}
                {preview.newPeople.length > 0 && <p>Will create: {preview.newPeople.join(", ")}</p>}
              </>
            )}
          </div>
          {preview.rows.length > 0 && (
            <div className="max-h-96 overflow-auto rounded-xl border border-line">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-surface-2"><tr><th className="p-2">Line</th><th className="p-2">Date</th><th className="p-2">Type</th><th className="p-2">Amount</th><th className="p-2">Who/what</th><th className="p-2">Issues</th></tr></thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className="border-t border-line align-top">
                      <td className="p-2">{r.line}</td><td className="p-2">{r.date}</td><td className="p-2">{r.type || "?"}</td>
                      <td className="num p-2">{r.amount}</td><td className="p-2">{r.person || r.category}</td>
                      <td className="p-2">{[...r.errors.map((e) => `Error: ${e}`), ...r.warnings.map((w) => `Warning: ${w}`)].join(" ") || "OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview.ok && <Button onClick={() => setConfirm(true)} className="w-full">Import {preview.totalRows} entries</Button>}
        </div>
      )}
      <StatusText status={status} />
      <ConfirmDialog open={confirm} title="Import these entries?" confirmLabel="Import" pending={pending} onCancel={() => setConfirm(false)}
        onConfirm={() => start(async () => {
          try {
            const r = await commitCsvAction(text, options());
            setConfirm(false);
            if (r.ok) { setPreview(null); setStatus({ tone: "ok", text: `Imported ${r.data.inserted} entries${r.data.peopleCreated ? `, created ${r.data.peopleCreated} people` : ""}.` }); }
            else setStatus({ tone: "error", text: r.message });
          } catch { setConfirm(false); setStatus({ tone: "error", text: "Could not reach the server. Nothing was imported." }); }
        })}>
        {preview && preview.warningCount > 0 ? `There are ${preview.warningCount} warnings (possible duplicates or balance changes). ` : ""}All rows are saved together, or none are.
      </ConfirmDialog>
    </div>
  );
}
