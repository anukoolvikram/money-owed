// CSV transaction export and validated CSV import (dry-run preview, then commit).
// A CSV is a transaction list only — it is NOT a full backup (use the JSON backup).
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import type { OwnerContext } from "../auth/owner";
import { IOU_DELTA, type Exec } from "./ledger-sql";
import { ServiceError } from "./errors";
import { ownerToday } from "./settings";
import { parseCsv, restoreFormula, toCsv } from "@/lib/csv";
import { isValidLocalDate, makeDate } from "@/lib/dates";
import { paiseToInput, parseRupees } from "@/lib/money";
import { iouDelta, isCategoryType, isIouType, PAYMENT_METHODS, TXN_TYPES, type PaymentMethod, type TxnType } from "@/lib/txn-types";
import { needsCrossZeroConfirm } from "./transactions";

export const MAX_CSV_BYTES = 1_000_000;
export const MAX_CSV_ROWS = 5_000;

export const TEMPLATE_HEADERS = ["date", "type", "amount", "account", "to_account", "category", "person", "person_label", "payment_method", "note"];

export async function exportTransactionsCsv(db: Exec, owner: OwnerContext): Promise<string> {
  const res = await db.execute<{
    date: string; type: string; amount: string; account: string; to_account: string | null; category: string | null;
    person: string | null; person_label: string | null; payment_method: string | null; note: string | null;
  }>(sql`
    SELECT t.txn_date::text AS date, t.type, t.amount_paise::text AS amount, a.name AS account, ta.name AS to_account,
      c.name AS category, p.name AS person, p.label AS person_label, t.payment_method, t.note
    FROM transactions t
    JOIN accounts a ON a.owner_id = t.owner_id AND a.id = t.account_id
    LEFT JOIN accounts ta ON ta.owner_id = t.owner_id AND ta.id = t.to_account_id
    LEFT JOIN categories c ON c.owner_id = t.owner_id AND c.id = t.category_id
    LEFT JOIN people p ON p.owner_id = t.owner_id AND p.id = t.person_id
    WHERE t.owner_id = ${owner.ownerId}
    ORDER BY t.txn_date, t.created_at, t.id`);
  return toCsv([
    TEMPLATE_HEADERS,
    ...res.rows.map((r) => [r.date, r.type, paiseToInput(BigInt(r.amount)), r.account, r.to_account, r.category, r.person, r.person_label, r.payment_method, r.note]),
  ]);
}

// ---------- import ----------

const outTypes = ["expense", "lend", "repayment_paid"] as const;
const inTypes = ["income", "borrow", "repayment_received"] as const;

export const importOptionsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("template"), dateFormat: z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"]).default("YYYY-MM-DD") }),
  z.object({
    mode: z.literal("sheet"),
    dateFormat: z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"]),
    columns: z.object({ date: z.string().min(1), person: z.string().optional(), moneyOut: z.string().optional(), moneyIn: z.string().optional(), note: z.string().optional() }),
    accountName: z.string().min(1, "Choose the account these entries used."),
    outType: z.enum(outTypes),
    inType: z.enum(inTypes),
    outCategory: z.string().optional(),
    inCategory: z.string().optional(),
    createMissingPeople: z.boolean().default(false),
  }),
]);
export type ImportOptions = z.infer<typeof importOptionsSchema>;

export type PreviewRow = {
  line: number;
  date: string;
  type: TxnType | "";
  amount: string;
  account: string;
  toAccount: string;
  category: string;
  person: string;
  note: string;
  errors: string[];
  warnings: string[];
};

export type ImportPreview = {
  ok: boolean;
  fileError?: string;
  rows: PreviewRow[];
  errorCount: number;
  warningCount: number;
  newPeople: string[];
  headers: string[];
  batchHash: string;
  alreadyImported: boolean;
};

function parseDate(s: string, fmt: string): string | null {
  const v = s.trim();
  let y: number, m: number, d: number;
  if (fmt === "YYYY-MM-DD") {
    const r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
    if (!r) return null;
    [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  } else {
    const r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
    if (!r) return null;
    [d, m, y] = fmt === "DD/MM/YYYY" ? [Number(r[1]), Number(r[2]), Number(r[3])] : [Number(r[2]), Number(r[1]), Number(r[3])];
  }
  const out = makeDate(y, m, d);
  return isValidLocalDate(out) ? out : null;
}

type Ref = { id: string; name: string; archived: boolean; openingDate?: string; kind?: string; label?: string | null };

async function loadRefs(db: Exec, ownerId: string) {
  const accounts = (await db.execute<Ref>(sql`SELECT id, name, (archived_at IS NOT NULL) AS archived, opening_date::text AS "openingDate" FROM accounts WHERE owner_id = ${ownerId}`)).rows;
  const categories = (await db.execute<Ref>(sql`SELECT id, name, kind, (archived_at IS NOT NULL) AS archived FROM categories WHERE owner_id = ${ownerId}`)).rows;
  const people = (await db.execute<Ref & { net: string }>(sql`
    SELECT p.id, p.name, p.label, (p.archived_at IS NOT NULL) AS archived, p.opening_date::text AS "openingDate",
      (p.opening_iou_paise + COALESCE(SUM(${IOU_DELTA}), 0))::text AS net
    FROM people p LEFT JOIN transactions t ON t.owner_id = p.owner_id AND t.person_id = p.id
    WHERE p.owner_id = ${ownerId} GROUP BY p.id`)).rows;
  return { accounts, categories, people };
}

const norm = (s: string) => s.trim().toLowerCase();

type Resolved = {
  line: number; type: TxnType; amountPaise: bigint; date: string; accountId: string; toAccountId: string | null;
  categoryId: string | null; personId: string | null; newPersonName: string | null; note: string | null; paymentMethod: PaymentMethod | null;
};

/** Builds the preview. Pure validation — never writes. */
export async function previewCsvImport(db: Exec, owner: OwnerContext, text: string, rawOptions: unknown): Promise<{ preview: ImportPreview; resolved: Resolved[] }> {
  const empty = (fileError: string, headers: string[] = []): { preview: ImportPreview; resolved: Resolved[] } => ({
    preview: { ok: false, fileError, rows: [], errorCount: 1, warningCount: 0, newPeople: [], headers, batchHash: "", alreadyImported: false },
    resolved: [],
  });
  if (typeof text !== "string" || text.length === 0) return empty("The file is empty.");
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) return empty("The file is larger than 1 MB. Split it into smaller files.");
  const parsed = parseCsv(text, MAX_CSV_ROWS + 1);
  if (!parsed.ok) return empty(parsed.error);
  if (parsed.rows.length < 2) return empty("The file has no data rows.");
  const headers = parsed.rows[0].map((h) => h.trim());
  const opt = importOptionsSchema.safeParse(rawOptions);
  if (!opt.success) return empty(opt.error.issues[0]?.message ?? "Choose the import options.", headers);
  const o = opt.data;
  const batchHash = createHash("sha256").update(text).update("\0").update(JSON.stringify(o)).digest("hex");

  const col = (name: string | undefined) => (name ? headers.findIndex((h) => norm(h) === norm(name)) : -1);
  if (o.mode === "template") {
    const missing = ["date", "type", "amount", "account"].filter((h) => col(h) < 0);
    if (missing.length) return empty(`Missing required columns: ${missing.join(", ")}. Download the template to see the expected format.`, headers);
  } else {
    for (const [k, v] of Object.entries(o.columns)) if (v && col(v) < 0) return empty(`Column “${v}” (for ${k}) was not found.`, headers);
    if (!o.columns.moneyIn && !o.columns.moneyOut) return empty("Map at least one of Money in / Money out.", headers);
  }

  const refs = await loadRefs(db, owner.ownerId);
  const today = await ownerToday(db, owner);
  const already = (await db.execute(sql`SELECT 1 FROM import_batches WHERE owner_id = ${owner.ownerId} AND content_hash = ${batchHash}`)).rows.length > 0;
  const findAccount = (n: string) => refs.accounts.filter((a) => norm(a.name) === norm(n));
  const findCategory = (n: string, kind: string) => refs.categories.filter((c) => norm(c.name) === norm(n) && c.kind === kind);
  const findPerson = (n: string, label?: string) =>
    refs.people.filter((p) => norm(p.name) === norm(n) && (label === undefined || norm(p.label ?? "") === norm(label)));

  const rows: PreviewRow[] = [];
  const resolved: Resolved[] = [];
  const newPeople = new Set<string>();
  const runningNet = new Map(refs.people.map((p) => [p.id, BigInt((p as unknown as { net: string }).net)]));
  const seenKeys = new Set<string>();
  const cell = (r: string[], i: number) => (i >= 0 ? restoreFormula(r[i] ?? "").trim() : "");

  // Existing entries, for duplicate detection.
  const existing = new Set(
    (await db.execute<{ k: string }>(sql`SELECT txn_date::text || '|' || type || '|' || amount_paise::text || '|' || account_id || '|' || COALESCE(person_id::text, category_id::text, to_account_id::text, '') AS k
      FROM transactions WHERE owner_id = ${owner.ownerId}`)).rows.map((r) => r.k),
  );

  for (let i = 1; i < parsed.rows.length; i++) {
    const r = parsed.rows[i];
    const line = i + 1;
    const errors: string[] = [];
    const warnings: string[] = [];
    let type: TxnType | "" = "";
    let amountStr = "";
    let accountName = "";
    let toAccountName = "";
    let categoryName = "";
    let personName = "";
    let personLabel: string | undefined;
    let pm = "";
    let note = "";
    let dateRaw = "";

    if (o.mode === "template") {
      dateRaw = cell(r, col("date"));
      const t = norm(cell(r, col("type")));
      if ((TXN_TYPES as readonly string[]).includes(t)) type = t as TxnType;
      else errors.push(`Unknown type “${cell(r, col("type"))}”. Use one of: ${TXN_TYPES.join(", ")}.`);
      amountStr = cell(r, col("amount"));
      accountName = cell(r, col("account"));
      toAccountName = cell(r, col("to_account"));
      categoryName = cell(r, col("category"));
      personName = cell(r, col("person"));
      personLabel = col("person_label") >= 0 ? cell(r, col("person_label")) : undefined;
      pm = norm(cell(r, col("payment_method")));
      note = cell(r, col("note"));
    } else {
      dateRaw = cell(r, col(o.columns.date));
      const out = cell(r, col(o.columns.moneyOut));
      const inn = cell(r, col(o.columns.moneyIn));
      if (out && inn) errors.push("Both Money out and Money in are filled. Split this into two rows.");
      else if (!out && !inn) errors.push("Neither Money out nor Money in has an amount.");
      else if (out) {
        type = o.outType;
        amountStr = out;
        categoryName = o.outType === "expense" ? (o.outCategory ?? "") : "";
      } else {
        type = o.inType;
        amountStr = inn;
        categoryName = o.inType === "income" ? (o.inCategory ?? "") : "";
      }
      accountName = o.accountName;
      personName = cell(r, col(o.columns.person));
      note = cell(r, col(o.columns.note));
    }

    const date = parseDate(dateRaw, o.dateFormat);
    if (!date) errors.push(`Date “${dateRaw}” is not a valid ${o.dateFormat} date.`);
    else if (date > today) errors.push("Future dates are not allowed.");
    const amt = parseRupees(amountStr.replace(/^-/, ""));
    if (!amt.ok) errors.push(`Amount: ${amt.error}`);
    if (note.length > 500) errors.push("Note is longer than 500 characters.");
    if (pm && !(PAYMENT_METHODS as readonly string[]).includes(pm)) errors.push(`Unknown payment method “${pm}”.`);

    const acc = findAccount(accountName);
    if (!accountName) errors.push("Account is missing.");
    else if (acc.length === 0) errors.push(`No account named “${accountName}”. Create it first.`);
    else if (acc.length > 1) errors.push(`More than one account is named “${accountName}”. Rename one first.`);
    else if (acc[0].archived) errors.push(`Account “${accountName}” is archived.`);
    else if (date && date < acc[0].openingDate!) errors.push(`Date is before the opening date of “${accountName}”.`);

    let toAccountId: string | null = null;
    let categoryId: string | null = null;
    let personId: string | null = null;
    let newPersonName: string | null = null;
    if (type === "transfer") {
      const to = findAccount(toAccountName);
      if (to.length !== 1) errors.push(toAccountName ? `No single account named “${toAccountName}”.` : "Transfer needs to_account.");
      else if (to[0].id === acc[0]?.id) errors.push("Transfer to the same account.");
      else if (to[0].archived) errors.push(`Account “${toAccountName}” is archived.`);
      else if (date && date < to[0].openingDate!) errors.push(`Date is before the opening date of “${toAccountName}”.`);
      else toAccountId = to[0].id;
    } else if (type && isCategoryType(type)) {
      const c = findCategory(categoryName, type);
      if (!categoryName) errors.push(`An ${type} needs a category.`);
      else if (c.length === 0) errors.push(`No ${type} category named “${categoryName}”.`);
      else if (c[0].archived) errors.push(`Category “${categoryName}” is archived.`);
      else categoryId = c[0].id;
    } else if (type && isIouType(type)) {
      const p = findPerson(personName, personLabel || undefined);
      if (!personName) errors.push("This entry needs a person.");
      else if (p.length > 1) errors.push(`More than one person is named “${personName}”. Add a person_label column to choose.`);
      else if (p.length === 1) {
        if (p[0].archived) errors.push(`${personName} is archived.`);
        else if (date && date < p[0].openingDate!) errors.push(`Date is before ${personName}'s opening date.`);
        else personId = p[0].id;
      } else if (o.mode === "sheet" && o.createMissingPeople) {
        newPersonName = personName.slice(0, 60);
        newPeople.add(newPersonName);
      } else errors.push(`No person named “${personName}”. Add them first${o.mode === "sheet" ? " or tick “create missing people”" : ""}.`);
    }

    if (!errors.length && type && amt.ok && date) {
      const key = `${date}|${type}|${amt.paise}|${acc[0].id}|${personId ?? categoryId ?? toAccountId ?? ""}`;
      if (existing.has(key)) warnings.push("Possible duplicate of an existing entry.");
      if (seenKeys.has(key + "|" + (newPersonName ?? ""))) warnings.push("Possible duplicate of another row in this file.");
      seenKeys.add(key + "|" + (newPersonName ?? ""));
      if (isIouType(type)) {
        const pk = personId ?? `new:${newPersonName}`;
        const before = runningNet.get(pk) ?? 0n;
        const after = before + iouDelta(type, amt.paise);
        if (needsCrossZeroConfirm(type, before, after)) warnings.push("Changes who owes whom (crosses zero).");
        runningNet.set(pk, after);
      }
      resolved.push({
        line, type, amountPaise: amt.paise, date, accountId: acc[0].id, toAccountId, categoryId, personId, newPersonName,
        note: note || null, paymentMethod: (pm || null) as PaymentMethod | null,
      });
    }
    rows.push({ line, date: date ?? dateRaw, type, amount: amountStr, account: accountName, toAccount: toAccountName, category: categoryName, person: personName, note, errors, warnings });
  }
  const errorCount = rows.reduce((n, r) => n + r.errors.length, 0);
  const warningCount = rows.reduce((n, r) => n + r.warnings.length, 0);
  return {
    preview: { ok: errorCount === 0 && !already, rows, errorCount, warningCount, newPeople: [...newPeople], headers, batchHash, alreadyImported: already },
    resolved,
  };
}

/** Commits a CSV import atomically. Any error means nothing is written. Same batch twice = no-op error. */
export async function commitCsvImport(db: DB, owner: OwnerContext, text: string, rawOptions: unknown): Promise<{ inserted: number; peopleCreated: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"import:" + owner.ownerId}))`);
    const { preview, resolved } = await previewCsvImport(tx, owner, text, rawOptions);
    if (preview.alreadyImported) throw new ServiceError("conflict", "This exact file was already imported with these options. Nothing was added.");
    if (!preview.ok) throw new ServiceError("validation", `The file has ${preview.errorCount} problem(s). Nothing was imported.`);
    const o = owner.ownerId;
    const batch = await tx.execute<{ id: string }>(sql`
      INSERT INTO import_batches (owner_id, kind, content_hash, row_count) VALUES (${o}, 'csv', ${preview.batchHash}, ${resolved.length})
      ON CONFLICT (owner_id, content_hash) DO NOTHING RETURNING id`);
    if (!batch.rows[0]) throw new ServiceError("conflict", "This exact file was already imported. Nothing was added.");
    const batchId = batch.rows[0].id;
    const created = new Map<string, string>();
    const earliest = new Map<string, string>();
    for (const r of resolved) if (r.newPersonName && (!earliest.has(r.newPersonName) || r.date < earliest.get(r.newPersonName)!)) earliest.set(r.newPersonName, r.date);
    for (const [name, d] of earliest) {
      const p = await tx.execute<{ id: string }>(sql`INSERT INTO people (owner_id, name, opening_iou_paise, opening_date) VALUES (${o}, ${name}, 0, ${d}) RETURNING id`);
      created.set(name, p.rows[0].id);
    }
    const CHUNK = 500;
    for (let s = 0; s < resolved.length; s += CHUNK) {
      const values = resolved.slice(s, s + CHUNK).map(
        (r, j) => sql`(${o}, ${r.type}::txn_type, ${r.amountPaise.toString()}::bigint, ${r.date}::date, ${r.accountId}::uuid, ${r.toAccountId}::uuid,
          ${r.categoryId}::uuid, ${r.personId ?? (r.newPersonName ? created.get(r.newPersonName)! : null)}::uuid, ${r.note},
          ${r.paymentMethod}::payment_method, ${`csv:${preview.batchHash.slice(0, 24)}:${s + j}`}, ${batchId}::uuid)`,
      );
      await tx.execute(sql`INSERT INTO transactions (owner_id, type, amount_paise, txn_date, account_id, to_account_id, category_id, person_id,
        note, payment_method, idempotency_key, import_batch_id) VALUES ${sql.join(values, sql`, `)}`);
    }
    return { inserted: resolved.length, peopleCreated: created.size };
  });
}
