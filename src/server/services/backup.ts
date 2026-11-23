// Full JSON backup and restore-into-empty-ledger.
// The backup never contains owner ids, auth tables, password hashes, sessions or secrets.
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import type { OwnerContext } from "../auth/owner";
import type { Exec } from "./ledger-sql";
import { ServiceError } from "./errors";
import { getSettings, ownerToday } from "./settings";
import { isValidLocalDate, isValidTimezone } from "@/lib/dates";
import { MAX_PAISE } from "@/lib/money";
import { isCategoryType, isIouType, PAYMENT_METHODS, TXN_TYPES } from "@/lib/txn-types";

export const BACKUP_FORMAT = "personal-ledger-backup";
export const BACKUP_VERSION = 1;
export const MAX_IMPORT_BYTES = 1_500_000; // stays well under Vercel's 4.5 MB body limit
export const MAX_BACKUP_TRANSACTIONS = 10_000;

export async function exportBackup(db: Exec, owner: OwnerContext) {
  const o = owner.ownerId;
  const settings = await getSettings(db, owner);
  const q = async <T>(s: ReturnType<typeof sql>) => (await db.execute<T & Record<string, unknown>>(s)).rows as T[];
  const accounts = await q<{ id: string; name: string; kind: string; openingBalancePaise: string; openingDate: string; archived: boolean }>(sql`
    SELECT id, name, kind, opening_balance_paise::text AS "openingBalancePaise", opening_date::text AS "openingDate", (archived_at IS NOT NULL) AS archived
    FROM accounts WHERE owner_id = ${o} ORDER BY created_at, id`);
  const categories = await q<{ id: string; name: string; kind: string; archived: boolean }>(sql`
    SELECT id, name, kind, (archived_at IS NOT NULL) AS archived FROM categories WHERE owner_id = ${o} ORDER BY created_at, id`);
  const people = await q<{ id: string; name: string; label: string | null; color: string | null; openingIouPaise: string; openingDate: string; archived: boolean }>(sql`
    SELECT id, name, label, color, opening_iou_paise::text AS "openingIouPaise", opening_date::text AS "openingDate", (archived_at IS NOT NULL) AS archived
    FROM people WHERE owner_id = ${o} ORDER BY created_at, id`);
  const transactions = await q<Record<string, unknown>>(sql`
    SELECT id, type, amount_paise::text AS "amountPaise", txn_date::text AS date, account_id AS "accountId", to_account_id AS "toAccountId",
      category_id AS "categoryId", person_id AS "personId", note, payment_method AS "paymentMethod",
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"
    FROM transactions WHERE owner_id = ${o} ORDER BY txn_date, created_at, id`);
  const periods = await q<{ id: string; periodStart: string; periodEnd: string; overallLimitPaise: string | null }>(sql`
    SELECT id, period_start::text AS "periodStart", period_end::text AS "periodEnd", overall_limit_paise::text AS "overallLimitPaise"
    FROM budget_periods WHERE owner_id = ${o} ORDER BY period_start`);
  const limits = await q<{ budgetPeriodId: string; categoryId: string; limitPaise: string }>(sql`
    SELECT budget_period_id AS "budgetPeriodId", category_id AS "categoryId", limit_paise::text AS "limitPaise"
    FROM budget_category_limits WHERE owner_id = ${o} ORDER BY budget_period_id, category_id`);
  const openingChanges = await q<Record<string, unknown>>(sql`
    SELECT subject_type AS "subjectType", subject_id AS "subjectId", old_paise::text AS "oldPaise", new_paise::text AS "newPaise",
      old_date::text AS "oldDate", new_date::text AS "newDate",
      to_char(changed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "changedAt"
    FROM opening_changes WHERE owner_id = ${o} ORDER BY changed_at, id`);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    note: "Private financial data. Not encrypted. Contains no passwords or login sessions.",
    settings,
    accounts,
    categories,
    people,
    transactions,
    budgets: periods.map((p) => ({
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      overallLimitPaise: p.overallLimitPaise,
      categoryLimits: limits.filter((l) => l.budgetPeriodId === p.id).map((l) => ({ categoryId: l.categoryId, limitPaise: l.limitPaise })),
    })),
    openingChanges,
  };
}

// ---------- restore ----------

const paise = (opts: { signed?: boolean; positive?: boolean }) =>
  z.string().regex(/^-?\d{1,16}$/, "must be a whole number of paise").refine((s) => {
    if (!/^-?\d{1,16}$/.test(s)) return true; // already reported by the regex check
    const v = BigInt(s);
    if (!opts.signed && v < 0n) return false;
    if (opts.positive && v <= 0n) return false;
    return (v < 0n ? -v : v) <= MAX_PAISE;
  }, "is out of range");
const date = z.string().refine(isValidLocalDate, "is not a valid date");
const id = z.string().min(1).max(64);
const text = (max: number) => z.string().max(max);

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  settings: z.object({
    timezone: z.string().refine(isValidTimezone, "is not a valid timezone"),
    cycleStartDay: z.number().int().min(1).max(31),
    theme: z.enum(["system", "light", "dark"]),
  }),
  accounts: z.array(z.object({ id, name: text(60).min(1), kind: z.enum(["cash", "bank", "wallet"]), openingBalancePaise: paise({ signed: true }), openingDate: date, archived: z.boolean() })).max(500),
  categories: z.array(z.object({ id, name: text(40).min(1), kind: z.enum(["expense", "income"]), archived: z.boolean() })).max(500),
  people: z.array(z.object({ id, name: text(60).min(1), label: text(40).min(1).nullable(), color: z.string().regex(/^#[0-9a-f]{6}$/).nullable().optional(), openingIouPaise: paise({ signed: true }), openingDate: date, archived: z.boolean() })).max(2000),
  transactions: z.array(z.object({
    id,
    type: z.enum(TXN_TYPES),
    amountPaise: paise({ positive: true }),
    date,
    accountId: id,
    toAccountId: id.nullable(),
    categoryId: id.nullable(),
    personId: id.nullable(),
    note: text(500).nullable(),
    paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
    createdAt: z.iso.datetime(),
  })).max(MAX_BACKUP_TRANSACTIONS),
  budgets: z.array(z.object({
    periodStart: date,
    periodEnd: date,
    overallLimitPaise: paise({ positive: true }).nullable(),
    categoryLimits: z.array(z.object({ categoryId: id, limitPaise: paise({ positive: true }) })).max(500),
  })).max(1200),
  openingChanges: z.array(z.object({
    subjectType: z.enum(["account", "person"]), subjectId: id, oldPaise: paise({ signed: true }), newPaise: paise({ signed: true }),
    oldDate: date, newDate: date, changedAt: z.iso.datetime(),
  })).max(5000).default([]),
});
export type Backup = z.infer<typeof backupSchema>;

export type RestorePreview = {
  ok: boolean;
  errors: string[];
  counts: { accounts: number; categories: number; people: number; transactions: number; budgets: number };
  contentHash: string;
};

function hashOf(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

async function ledgerIsEmpty(db: Exec, ownerId: string): Promise<boolean> {
  const r = await db.execute<{ n: string }>(sql`
    SELECT ((SELECT count(*) FROM accounts WHERE owner_id = ${ownerId}) + (SELECT count(*) FROM people WHERE owner_id = ${ownerId})
      + (SELECT count(*) FROM transactions WHERE owner_id = ${ownerId}) + (SELECT count(*) FROM budget_periods WHERE owner_id = ${ownerId}))::text AS n`);
  return r.rows[0].n === "0";
}

/** Validates a backup completely (shape, references, rules) without writing anything. */
export async function previewRestore(db: Exec, owner: OwnerContext, raw: string): Promise<{ preview: RestorePreview; backup?: Backup }> {
  const errors: string[] = [];
  const empty = { accounts: 0, categories: 0, people: 0, transactions: 0, budgets: 0 };
  const contentHash = hashOf(raw);
  if (Buffer.byteLength(raw, "utf8") > MAX_IMPORT_BYTES) return { preview: { ok: false, errors: ["The file is larger than 1.5 MB."], counts: empty, contentHash } };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { preview: { ok: false, errors: ["This is not a valid JSON file."], counts: empty, contentHash } };
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 50)) errors.push(`${i.path.join(".") || "file"}: ${i.message}`);
    return { preview: { ok: false, errors, counts: empty, contentHash } };
  }
  const b = parsed.data;
  const counts = { accounts: b.accounts.length, categories: b.categories.length, people: b.people.length, transactions: b.transactions.length, budgets: b.budgets.length };
  if (!(await ledgerIsEmpty(db, owner.ownerId))) errors.push("Your ledger already has accounts, people, entries or budgets. Restore only works into an empty ledger.");

  const uniq = (arr: { id: string }[], what: string) => {
    const s = new Set<string>();
    for (const x of arr) {
      if (s.has(x.id)) errors.push(`Duplicate ${what} id ${x.id}.`);
      s.add(x.id);
    }
  };
  uniq(b.accounts, "account");
  uniq(b.categories, "category");
  uniq(b.people, "person");
  uniq(b.transactions, "entry");
  const acc = new Map(b.accounts.map((a) => [a.id, a]));
  const cat = new Map(b.categories.map((c) => [c.id, c]));
  const ppl = new Map(b.people.map((p) => [p.id, p]));
  const catNames = new Set<string>();
  for (const c of b.categories) {
    const k = `${c.kind}:${c.name.toLowerCase()}`;
    if (catNames.has(k)) errors.push(`Duplicate category name “${c.name}”.`);
    catNames.add(k);
  }
  const today = await ownerToday(db, owner);
  b.transactions.forEach((t, i) => {
    const row = `Entry ${i + 1} (${t.date})`;
    const a = acc.get(t.accountId);
    if (!a) errors.push(`${row}: unknown account.`);
    else if (t.date < a.openingDate) errors.push(`${row}: before the account's opening date.`);
    if (t.date > today) errors.push(`${row}: future date.`);
    if (t.type === "transfer") {
      const to = t.toAccountId ? acc.get(t.toAccountId) : undefined;
      if (!to) errors.push(`${row}: transfer needs a destination account.`);
      else if (t.toAccountId === t.accountId) errors.push(`${row}: transfer to the same account.`);
      else if (t.date < to.openingDate) errors.push(`${row}: before the destination account's opening date.`);
      if (t.categoryId || t.personId) errors.push(`${row}: transfer cannot have a category or person.`);
    } else if (isCategoryType(t.type)) {
      const c = t.categoryId ? cat.get(t.categoryId) : undefined;
      if (!c) errors.push(`${row}: unknown category.`);
      else if (c.kind !== t.type) errors.push(`${row}: category kind does not match.`);
      if (t.toAccountId || t.personId) errors.push(`${row}: unexpected transfer account or person.`);
    } else if (isIouType(t.type)) {
      const p = t.personId ? ppl.get(t.personId) : undefined;
      if (!p) errors.push(`${row}: unknown person.`);
      else if (t.date < p.openingDate) errors.push(`${row}: before the person's opening date.`);
      if (t.toAccountId || t.categoryId) errors.push(`${row}: unexpected transfer account or category.`);
    }
  });
  const starts = new Set<string>();
  for (const bp of b.budgets) {
    if (bp.periodEnd <= bp.periodStart) errors.push(`Budget ${bp.periodStart}: end must be after start.`);
    if (starts.has(bp.periodStart)) errors.push(`Budget ${bp.periodStart}: duplicate period.`);
    starts.add(bp.periodStart);
    for (const l of bp.categoryLimits) {
      const c = cat.get(l.categoryId);
      if (!c || c.kind !== "expense") errors.push(`Budget ${bp.periodStart}: limit for an unknown or non-expense category.`);
    }
  }
  for (const oc of b.openingChanges) {
    if (!(oc.subjectType === "account" ? acc.has(oc.subjectId) : ppl.has(oc.subjectId))) errors.push(`Opening change for an unknown ${oc.subjectType}.`);
  }
  return { preview: { ok: errors.length === 0, errors: errors.slice(0, 100), counts, contentHash }, backup: b };
}

/**
 * Restores a validated backup in ONE database transaction. IDs are remapped to
 * new ones under the signed-in owner; nothing is merged or overwritten.
 */
export async function commitRestore(db: DB, owner: OwnerContext, raw: string): Promise<RestorePreview["counts"]> {
  return db.transaction(async (tx) => {
    // Serialise restores for this owner.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"restore:" + owner.ownerId}))`);
    const { preview, backup: b } = await previewRestore(tx, owner, raw);
    if (!preview.ok || !b) throw new ServiceError("validation", "The backup did not pass validation. Nothing was restored.", {}, { errors: preview.errors.join("\n") });
    const o = owner.ownerId;
    const batch = await tx.execute<{ id: string }>(sql`
      INSERT INTO import_batches (owner_id, kind, content_hash, row_count) VALUES (${o}, 'json', ${preview.contentHash}, ${b.transactions.length})
      ON CONFLICT (owner_id, content_hash) DO NOTHING RETURNING id`);
    if (!batch.rows[0]) throw new ServiceError("conflict", "This exact backup was already restored.");
    const batchId = batch.rows[0].id;

    await tx.execute(sql`UPDATE owner_settings SET timezone = ${b.settings.timezone}, cycle_start_day = ${b.settings.cycleStartDay}, theme = ${b.settings.theme}, updated_at = now() WHERE owner_id = ${o}`);
    // The ledger is empty, so its categories are unused defaults; replace them with the backup's.
    await tx.execute(sql`DELETE FROM categories WHERE owner_id = ${o}`);

    const map = new Map<string, string>();
    const ins = async (key: string, q: ReturnType<typeof sql>) => {
      const r = await tx.execute<{ id: string }>(q);
      map.set(key, r.rows[0].id);
    };
    // Created-at values are spaced 1 ms apart so lists keep the backup's original order.
    const at = (i: number) => sql`now() + make_interval(secs => ${i} / 1000.0)`;
    for (const [i, a] of b.accounts.entries())
      await ins(`a:${a.id}`, sql`INSERT INTO accounts (owner_id, name, kind, opening_balance_paise, opening_date, archived_at, created_at)
        VALUES (${o}, ${a.name}, ${a.kind}, ${a.openingBalancePaise}::bigint, ${a.openingDate}, ${a.archived ? sql`now()` : null}, ${at(i)}) RETURNING id`);
    for (const [i, c] of b.categories.entries())
      await ins(`c:${c.id}`, sql`INSERT INTO categories (owner_id, name, kind, archived_at, created_at)
        VALUES (${o}, ${c.name}, ${c.kind}, ${c.archived ? sql`now()` : null}, ${at(i)}) RETURNING id`);
    for (const [i, p] of b.people.entries())
      await ins(`p:${p.id}`, sql`INSERT INTO people (owner_id, name, label, color, opening_iou_paise, opening_date, archived_at, created_at)
        VALUES (${o}, ${p.name}, ${p.label}, ${p.color ?? null}, ${p.openingIouPaise}::bigint, ${p.openingDate}, ${p.archived ? sql`now()` : null}, ${at(i)}) RETURNING id`);
    const m = (prefix: string, v: string | null) => (v ? map.get(`${prefix}:${v}`)! : null);
    const CHUNK = 500; // batched multi-row inserts: few round trips even on a remote database
    for (let start = 0; start < b.transactions.length; start += CHUNK) {
      const values = b.transactions.slice(start, start + CHUNK).map(
        (t, j) => sql`(${o}, ${t.type}::txn_type, ${t.amountPaise}::bigint, ${t.date}::date, ${m("a", t.accountId)}::uuid, ${m("a", t.toAccountId)}::uuid,
          ${m("c", t.categoryId)}::uuid, ${m("p", t.personId)}::uuid, ${t.note}, ${t.paymentMethod}::payment_method,
          ${`restore:${preview.contentHash.slice(0, 24)}:${start + j}`}, ${batchId}::uuid, ${t.createdAt}::timestamptz, now())`,
      );
      await tx.execute(sql`INSERT INTO transactions (owner_id, type, amount_paise, txn_date, account_id, to_account_id, category_id, person_id,
          note, payment_method, idempotency_key, import_batch_id, created_at, updated_at) VALUES ${sql.join(values, sql`, `)}`);
    }
    for (const bp of b.budgets) {
      const r = await tx.execute<{ id: string }>(sql`INSERT INTO budget_periods (owner_id, period_start, period_end, overall_limit_paise)
        VALUES (${o}, ${bp.periodStart}, ${bp.periodEnd}, ${bp.overallLimitPaise}::bigint) RETURNING id`);
      for (const l of bp.categoryLimits)
        await tx.execute(sql`INSERT INTO budget_category_limits (owner_id, budget_period_id, category_id, limit_paise)
          VALUES (${o}, ${r.rows[0].id}, ${m("c", l.categoryId)}, ${l.limitPaise}::bigint)`);
    }
    for (const oc of b.openingChanges)
      await tx.execute(sql`INSERT INTO opening_changes (owner_id, subject_type, subject_id, old_paise, new_paise, old_date, new_date, changed_at)
        VALUES (${o}, ${oc.subjectType}, ${m(oc.subjectType === "account" ? "a" : "p", oc.subjectId)}, ${oc.oldPaise}::bigint, ${oc.newPaise}::bigint,
          ${oc.oldDate}, ${oc.newDate}, ${oc.changedAt}::timestamptz)`);
    return preview.counts;
  });
}
