import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { transactions } from "../db/schema";
import type { DB } from "../db/client";
import type { OwnerContext } from "../auth/owner";
import { personNets, type Exec } from "./ledger-sql";
import { transactionInput, uuid, localDate, type TransactionInput } from "./validators";
import { notFound, ServiceError, stale, validation } from "./errors";
import { parseOrThrow } from "./util";
import { ownerToday } from "./settings";
import { escapeLike } from "./people";
import { iouDelta, isCategoryType, isIouType, TXN_TYPES, type TxnType, type PaymentMethod } from "@/lib/txn-types";

export type TransactionDTO = {
  id: string;
  type: TxnType;
  amountPaise: string;
  date: string;
  accountId: string;
  accountName: string;
  toAccountId: string | null;
  toAccountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  personId: string | null;
  personName: string | null;
  personLabel: string | null;
  note: string | null;
  paymentMethod: PaymentMethod | null;
  version: number;
  createdAt: string;
};

type Existing = typeof transactions.$inferSelect;

/** Keeps only the references that make sense for the type (explicit allowlist). */
function normaliseRefs(input: TransactionInput) {
  const t = input.type;
  return {
    accountId: input.accountId,
    toAccountId: t === "transfer" ? (input.toAccountId ?? null) : null,
    categoryId: isCategoryType(t) ? (input.categoryId ?? null) : null,
    personId: isIouType(t) ? (input.personId ?? null) : null,
    paymentMethod: t === "transfer" ? null : (input.paymentMethod ?? null),
  };
}

type IouCheck = { personId: string; beforePaise: bigint; afterPaise: bigint } | null;

/**
 * Validates ownership, archive state, opening dates, category kind and date.
 * Locks the person row (FOR UPDATE) so concurrent IOU writes for the same person
 * are serialised and the cross-zero check is reliable.
 */
async function validateAndCheck(tx: Exec, owner: OwnerContext, input: TransactionInput, existing?: Existing): Promise<IouCheck> {
  const refs = normaliseRefs(input);
  const today = await ownerToday(tx, owner);
  const fe: Record<string, string> = {};
  if (input.date > today) fe.date = "Future dates are not allowed. Planned payments are not posted entries.";

  const lockAccount = async (id: string, field: string) => {
    const r = await tx.execute<{ id: string; opening_date: string; archived: boolean }>(sql`
      SELECT id, opening_date::text AS opening_date, (archived_at IS NOT NULL) AS archived
      FROM accounts WHERE owner_id = ${owner.ownerId} AND id = ${id} FOR SHARE`);
    const a = r.rows[0];
    if (!a) return void (fe[field] = "Choose one of your accounts.");
    const unchanged = existing && (existing.accountId === id || existing.toAccountId === id);
    if (a.archived && !unchanged) fe[field] = "This account is archived. Choose an active account.";
    else if (input.date < a.opening_date) fe.date = `This date is before the account's opening date (${a.opening_date}).`;
  };

  await lockAccount(refs.accountId, "accountId");
  if (input.type === "transfer") {
    if (!refs.toAccountId) fe.toAccountId = "Choose the account receiving the money.";
    else if (refs.toAccountId === refs.accountId) fe.toAccountId = "Choose two different accounts.";
    else await lockAccount(refs.toAccountId, "toAccountId");
  }

  if (isCategoryType(input.type)) {
    if (!refs.categoryId) fe.categoryId = "Choose a category.";
    else {
      const r = await tx.execute<{ kind: string; archived: boolean }>(sql`
        SELECT kind, (archived_at IS NOT NULL) AS archived FROM categories
        WHERE owner_id = ${owner.ownerId} AND id = ${refs.categoryId} FOR SHARE`);
      const c = r.rows[0];
      if (!c) fe.categoryId = "Choose one of your categories.";
      else if (c.kind !== input.type) fe.categoryId = `Choose an ${input.type} category.`;
      else if (c.archived && existing?.categoryId !== refs.categoryId) fe.categoryId = "This category is archived.";
    }
  }

  let iou: IouCheck = null;
  if (isIouType(input.type)) {
    if (!refs.personId) fe.personId = "Choose a person.";
    else {
      const r = await tx.execute<{ opening_date: string; archived: boolean }>(sql`
        SELECT opening_date::text AS opening_date, (archived_at IS NOT NULL) AS archived FROM people
        WHERE owner_id = ${owner.ownerId} AND id = ${refs.personId} FOR UPDATE`);
      const p = r.rows[0];
      if (!p) fe.personId = "Choose one of your people.";
      else {
        if (p.archived && existing?.personId !== refs.personId) fe.personId = "This person is archived. Unarchive them first.";
        if (input.date < p.opening_date) fe.date = `This date is before this person's opening date (${p.opening_date}).`;
        const nets = await personNets(tx, owner.ownerId, { personId: refs.personId, excludeTxnId: existing?.id });
        const before = nets.get(refs.personId) ?? 0n;
        iou = { personId: refs.personId, beforePaise: before, afterPaise: before + iouDelta(input.type, input.amount) };
      }
    }
  }

  if (Object.keys(fe).length) throw validation("Check the highlighted fields.", fe);

  if (iou && needsCrossZeroConfirm(input.type, iou.beforePaise, iou.afterPaise) && !input.confirmCrossZero) {
    throw new ServiceError("needs_confirmation", crossZeroMessage(input.type, iou.beforePaise, iou.afterPaise), {}, {
      beforePaise: iou.beforePaise.toString(),
      afterPaise: iou.afterPaise.toString(),
    });
  }
  return iou;
}

/**
 * True when an entry flips who owes whom, or a repayment does not reduce an
 * existing debt in that direction (e.g. "they repaid me" when they owe nothing).
 */
export function needsCrossZeroConfirm(type: TxnType, before: bigint, after: bigint): boolean {
  if ((before > 0n && after < 0n) || (before < 0n && after > 0n)) return true;
  if (type === "repayment_received" && before <= 0n) return true;
  if (type === "repayment_paid" && before >= 0n) return true;
  return false;
}

function crossZeroMessage(type: TxnType, before: bigint, after: bigint): string {
  const who = (n: bigint) => (n > 0n ? "they owe you" : n < 0n ? "you owe them" : "settled");
  if (type === "repayment_received" && before <= 0n)
    return `They don't currently owe you anything (${who(before)}). Saving this means ${who(after)}. Confirm to save anyway.`;
  if (type === "repayment_paid" && before >= 0n)
    return `You don't currently owe them anything (${who(before)}). Saving this means ${who(after)}. Confirm to save anyway.`;
  return `This entry changes the balance from "${who(before)}" to "${who(after)}". Confirm to save it as entered.`;
}

export type CreateResult = { id: string; duplicate: boolean; iou: { beforePaise: string; afterPaise: string } | null };

export async function createTransaction(db: DB, owner: OwnerContext, raw: unknown): Promise<CreateResult> {
  const input = parseOrThrow(transactionInput, raw);
  return db.transaction(async (tx) => {
    // Idempotency: a retry of an already-saved submission returns the original entry.
    const prior = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.ownerId, owner.ownerId), eq(transactions.idempotencyKey, input.idempotencyKey)));
    if (prior[0]) return { id: prior[0].id, duplicate: true, iou: null };

    const iou = await validateAndCheck(tx, owner, input);
    const refs = normaliseRefs(input);
    const inserted = await tx
      .insert(transactions)
      .values({
        ownerId: owner.ownerId,
        type: input.type,
        amountPaise: input.amount,
        txnDate: input.date,
        ...refs,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({ target: [transactions.ownerId, transactions.idempotencyKey] })
      .returning({ id: transactions.id });
    if (!inserted[0]) {
      // A concurrent request with the same key won the race.
      const again = await tx
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.ownerId, owner.ownerId), eq(transactions.idempotencyKey, input.idempotencyKey)));
      return { id: again[0].id, duplicate: true, iou: null };
    }
    return {
      id: inserted[0].id,
      duplicate: false,
      iou: iou ? { beforePaise: iou.beforePaise.toString(), afterPaise: iou.afterPaise.toString() } : null,
    };
  });
}

const updateSchema = transactionInput.omit({ idempotencyKey: true }).extend({
  id: uuid,
  version: z.coerce.number().int().positive(),
});

export async function updateTransaction(db: DB, owner: OwnerContext, raw: unknown): Promise<{ version: number }> {
  const input = parseOrThrow(updateSchema, raw);
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, input.id), eq(transactions.ownerId, owner.ownerId)))
      .for("update");
    if (!cur) throw notFound("Entry");
    if (cur.version !== input.version) throw stale();
    await validateAndCheck(tx, owner, { ...input, idempotencyKey: cur.idempotencyKey }, cur);
    const refs = normaliseRefs({ ...input, idempotencyKey: cur.idempotencyKey });
    const res = await tx
      .update(transactions)
      .set({
        type: input.type,
        amountPaise: input.amount,
        txnDate: input.date,
        ...refs,
        note: input.note ?? null,
        version: cur.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(transactions.id, input.id), eq(transactions.ownerId, owner.ownerId), eq(transactions.version, input.version)))
      .returning({ version: transactions.version });
    if (!res[0]) throw stale();
    return res[0];
  });
}

export async function deleteTransaction(db: DB, owner: OwnerContext, raw: unknown): Promise<void> {
  const input = parseOrThrow(z.object({ id: uuid, version: z.coerce.number().int().positive() }), raw);
  const res = await db
    .delete(transactions)
    .where(and(eq(transactions.id, input.id), eq(transactions.ownerId, owner.ownerId), eq(transactions.version, input.version)))
    .returning({ id: transactions.id });
  if (!res[0]) {
    const exists = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, input.id), eq(transactions.ownerId, owner.ownerId)));
    throw exists[0] ? stale() : notFound("Entry");
  }
}

const SELECT_DTO = sql`
  SELECT t.id, t.type, t.amount_paise::text AS amount, t.txn_date::text AS date,
    t.account_id, a.name AS account_name, t.to_account_id, ta.name AS to_account_name,
    t.category_id, c.name AS category_name, t.person_id, p.name AS person_name, p.label AS person_label,
    t.note, t.payment_method, t.version, t.created_at
  FROM transactions t
  JOIN accounts a ON a.owner_id = t.owner_id AND a.id = t.account_id
  LEFT JOIN accounts ta ON ta.owner_id = t.owner_id AND ta.id = t.to_account_id
  LEFT JOIN categories c ON c.owner_id = t.owner_id AND c.id = t.category_id
  LEFT JOIN people p ON p.owner_id = t.owner_id AND p.id = t.person_id`;

type Row = {
  id: string; type: TxnType; amount: string; date: string; account_id: string; account_name: string;
  to_account_id: string | null; to_account_name: string | null; category_id: string | null; category_name: string | null;
  person_id: string | null; person_name: string | null; person_label: string | null; note: string | null;
  payment_method: PaymentMethod | null; version: number; created_at: Date | string;
};

function toDTO(r: Row): TransactionDTO {
  return {
    id: r.id,
    type: r.type,
    amountPaise: r.amount,
    date: r.date,
    accountId: r.account_id,
    accountName: r.account_name,
    toAccountId: r.to_account_id,
    toAccountName: r.to_account_name,
    categoryId: r.category_id,
    categoryName: r.category_name,
    personId: r.person_id,
    personName: r.person_name,
    personLabel: r.person_label,
    note: r.note,
    paymentMethod: r.payment_method,
    version: r.version,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function getTransaction(db: Exec, owner: OwnerContext, id: string): Promise<TransactionDTO> {
  if (!uuid.safeParse(id).success) throw notFound("Entry");
  const res = await db.execute<Row>(sql`${SELECT_DTO} WHERE t.owner_id = ${owner.ownerId} AND t.id = ${id}`);
  if (!res.rows[0]) throw notFound("Entry");
  return toDTO(res.rows[0]);
}

export const listFilterSchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  type: z.enum(TXN_TYPES).optional().catch(undefined),
  accountId: uuid.optional().catch(undefined),
  categoryId: uuid.optional().catch(undefined),
  personId: uuid.optional().catch(undefined),
  from: localDate.optional().catch(undefined),
  to: localDate.optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
});
export type ListFilter = z.infer<typeof listFilterSchema>;

export const PAGE_SIZE = 30;

function encodeCursor(r: Row): string {
  return Buffer.from(JSON.stringify([r.date, new Date(r.created_at).toISOString(), r.id])).toString("base64url");
}
function decodeCursor(c: string): [string, string, string] | null {
  try {
    const v = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
    if (Array.isArray(v) && v.length === 3 && localDate.safeParse(v[0]).success && !isNaN(Date.parse(v[1])) && uuid.safeParse(v[2]).success)
      return v as [string, string, string];
  } catch {}
  return null;
}

/** Reverse-chronological, keyset-paginated list. All filters are owner-scoped and parameterised. */
export async function listTransactions(
  db: Exec,
  owner: OwnerContext,
  rawFilter: unknown,
  limit = PAGE_SIZE,
): Promise<{ items: TransactionDTO[]; nextCursor: string | null }> {
  const f = listFilterSchema.parse(rawFilter ?? {});
  const where: SQL[] = [sql`t.owner_id = ${owner.ownerId}`];
  if (f.type) where.push(sql`t.type = ${f.type}`);
  if (f.accountId) where.push(sql`(t.account_id = ${f.accountId} OR t.to_account_id = ${f.accountId})`);
  if (f.categoryId) where.push(sql`t.category_id = ${f.categoryId}`);
  if (f.personId) where.push(sql`t.person_id = ${f.personId}`);
  if (f.from) where.push(sql`t.txn_date >= ${f.from}`);
  if (f.to) where.push(sql`t.txn_date <= ${f.to}`);
  if (f.q) {
    const like = "%" + escapeLike(f.q) + "%";
    where.push(sql`(t.note ILIKE ${like} ESCAPE '\\' OR p.name ILIKE ${like} ESCAPE '\\' OR p.label ILIKE ${like} ESCAPE '\\'
      OR c.name ILIKE ${like} ESCAPE '\\' OR a.name ILIKE ${like} ESCAPE '\\' OR ta.name ILIKE ${like} ESCAPE '\\')`);
  }
  const cur = f.cursor ? decodeCursor(f.cursor) : null;
  if (cur) where.push(sql`(t.txn_date, t.created_at, t.id) < (${cur[0]}::date, ${cur[1]}::timestamptz, ${cur[2]}::uuid)`);
  const res = await db.execute<Row>(sql`${SELECT_DTO} WHERE ${sql.join(where, sql` AND `)}
    ORDER BY t.txn_date DESC, t.created_at DESC, t.id DESC LIMIT ${limit + 1}`);
  const rows = res.rows;
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return { items: page.map(toDTO), nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null };
}
