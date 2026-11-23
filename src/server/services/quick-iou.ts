// One-step "I lent / I borrowed" entry from the overview page.
// Picks (or creates) the person and an account automatically, then records the
// entry, all inside a single database transaction.
import { sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, people } from "../db/schema";
import type { DB } from "../db/client";
import type { OwnerContext } from "../auth/owner";
import type { Exec } from "./ledger-sql";
import { amountRupees, localDate, name, uuid } from "./validators";
import { parseOrThrow } from "./util";
import { newPersonColor } from "./people";
import { getTransaction, insertTransaction, updateTransaction, type CreateResult } from "./transactions";

const quickIouInput = z
  .object({
    type: z.enum(["lend", "borrow"]),
    amount: amountRupees,
    date: localDate,
    note: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(500).optional()),
    personId: z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional()),
    newPersonName: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), name(60).optional()),
    idempotencyKey: z.string().min(8).max(200).regex(/^[A-Za-z0-9:_\-]+$/),
  })
  .refine((v) => v.personId || v.newPersonName, { message: "Choose a person or enter a new name.", path: ["personId"] });

/** Returns an active person with this name, or creates one starting from zero. */
async function findOrCreatePerson(tx: Exec, owner: OwnerContext, personName: string, date: string): Promise<string> {
  const existing = await tx.execute<{ id: string }>(sql`
    SELECT id FROM people
    WHERE owner_id = ${owner.ownerId} AND archived_at IS NULL AND lower(name) = lower(${personName}) AND label IS NULL
    ORDER BY created_at LIMIT 1`);
  if (existing.rows[0]) return existing.rows[0].id;
  const [row] = await tx.insert(people).values({ ownerId: owner.ownerId, name: personName, color: await newPersonColor(tx, owner), openingIouPaise: 0n, openingDate: date }).returning({ id: people.id });
  return row.id;
}

/** Active account to record against: cash first, then the oldest. Creates "Cash" if there are none. */
async function pickAccount(tx: Exec, owner: OwnerContext, date: string): Promise<string> {
  const res = await tx.execute<{ id: string }>(sql`
    SELECT id FROM accounts
    WHERE owner_id = ${owner.ownerId} AND archived_at IS NULL
    ORDER BY (opening_date <= ${date}) DESC, (kind = 'cash') DESC, created_at LIMIT 1`);
  const a = res.rows[0];
  if (!a) {
    const [row] = await tx.insert(accounts).values({ ownerId: owner.ownerId, name: "Cash", kind: "cash", openingBalancePaise: 0n, openingDate: date }).returning({ id: accounts.id });
    return row.id;
  }
  return a.id;
}

/**
 * A person or account that started from zero can safely start earlier, so a
 * back-dated entry fits. Ones with a real opening balance are left alone (the
 * normal date check then explains the problem).
 */
async function allowDate(tx: Exec, owner: OwnerContext, personId: string, accountId: string, date: string) {
  // One statement (not two) to save a round trip to the database.
  await tx.execute(sql`
    WITH p AS (
      UPDATE people SET opening_date = ${date}, updated_at = now()
      WHERE owner_id = ${owner.ownerId} AND id = ${personId} AND opening_iou_paise = 0 AND opening_date > ${date}
      RETURNING 1
    ), a AS (
      UPDATE accounts SET opening_date = ${date}, updated_at = now()
      WHERE owner_id = ${owner.ownerId} AND id = ${accountId} AND opening_balance_paise = 0 AND opening_date > ${date}
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM p) + (SELECT count(*) FROM a) AS n`);
}

export async function createQuickIou(db: DB, owner: OwnerContext, raw: unknown): Promise<CreateResult & { personId: string }> {
  const input = parseOrThrow(quickIouInput, raw);
  // Future dates are rejected by insertTransaction's validation (inside the same transaction).
  return db.transaction(async (tx) => {
    // A retried submission returns the saved entry without creating another person.
    const prior = await tx.execute<{ id: string; person_id: string }>(sql`
      SELECT id, person_id FROM transactions WHERE owner_id = ${owner.ownerId} AND idempotency_key = ${input.idempotencyKey}`);
    if (prior.rows[0]) return { id: prior.rows[0].id, personId: prior.rows[0].person_id, duplicate: true, iou: null };

    const personId = input.personId ?? (await findOrCreatePerson(tx, owner, input.newPersonName!, input.date));
    const accountId = await pickAccount(tx, owner, input.date);
    await allowDate(tx, owner, personId, accountId, input.date);
    const res = await insertTransaction(tx, owner, {
      type: input.type,
      amount: input.amount,
      date: input.date,
      accountId,
      personId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      // The direction is explicit (Lend / Borrow), so flipping who owes whom is intended.
      confirmCrossZero: true,
    });
    return { ...res, personId };
  });
}

const quickIouUpdate = z.object({
  id: uuid,
  version: z.coerce.number().int().positive(),
  type: z.enum(["lend", "borrow"]),
  amount: z.string(),
  date: localDate,
  note: z.string().max(500).optional(),
  personId: uuid,
});

/** Edits a lend/borrow entry from the simple form. The entry keeps its account. */
export async function updateQuickIou(db: DB, owner: OwnerContext, raw: unknown): Promise<{ version: number }> {
  const input = parseOrThrow(quickIouUpdate, raw);
  const cur = await getTransaction(db, owner, input.id);
  await db.transaction((tx) => allowDate(tx, owner, input.personId, cur.accountId, input.date));
  return updateTransaction(db, owner, { ...input, accountId: cur.accountId, confirmCrossZero: true });
}
