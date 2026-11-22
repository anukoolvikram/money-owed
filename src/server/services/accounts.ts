import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { accounts, openingChanges } from "../db/schema";
import type { DB } from "../db/client";
import type { OwnerContext } from "../auth/owner";
import { accountBalances, type Exec } from "./ledger-sql";
import { accountInput, uuid } from "./validators";
import { notFound, ServiceError, stale, validation } from "./errors";
import { parseOrThrow } from "./util";
import { ownerToday } from "./settings";

export type AccountDTO = {
  id: string;
  name: string;
  kind: "cash" | "bank" | "wallet";
  openingBalancePaise: string;
  openingDate: string;
  balancePaise: string;
  archived: boolean;
  version: number;
};

export async function listAccounts(db: Exec, owner: OwnerContext, opts: { includeArchived?: boolean } = {}): Promise<AccountDTO[]> {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.ownerId, owner.ownerId), opts.includeArchived ? undefined : isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.archivedAt), asc(accounts.createdAt));
  const balances = await accountBalances(db, owner.ownerId);
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    openingBalancePaise: a.openingBalancePaise.toString(),
    openingDate: a.openingDate,
    balancePaise: (balances.get(a.id) ?? a.openingBalancePaise).toString(),
    archived: a.archivedAt !== null,
    version: a.version,
  }));
}

export async function getAccount(db: Exec, owner: OwnerContext, id: string): Promise<AccountDTO> {
  if (!uuid.safeParse(id).success) throw notFound("Account");
  const all = await listAccounts(db, owner, { includeArchived: true });
  const a = all.find((x) => x.id === id);
  if (!a) throw notFound("Account");
  return a;
}

export async function createAccount(db: DB, owner: OwnerContext, raw: unknown): Promise<{ id: string }> {
  const input = parseOrThrow(accountInput, raw);
  const today = await ownerToday(db, owner);
  if (input.openingDate > today) throw validation("The opening date cannot be in the future.", { openingDate: "Cannot be in the future" });
  const [row] = await db
    .insert(accounts)
    .values({
      ownerId: owner.ownerId,
      name: input.name,
      kind: input.kind,
      openingBalancePaise: input.openingBalance,
      openingDate: input.openingDate,
    })
    .returning({ id: accounts.id });
  return row;
}

const updateSchema = accountInput.extend({
  id: uuid,
  version: z.coerce.number().int().positive(),
  confirmOpeningChange: z.boolean().optional(),
});

/**
 * Updates an account. Changing the opening balance or date is a deliberate
 * correction: it needs confirmation, is recorded in opening_changes, and never
 * creates a fake transaction or counts as income.
 */
export async function updateAccount(db: DB, owner: OwnerContext, raw: unknown): Promise<void> {
  const input = parseOrThrow(updateSchema, raw);
  const today = await ownerToday(db, owner);
  if (input.openingDate > today) throw validation("The opening date cannot be in the future.", { openingDate: "Cannot be in the future" });

  await db.transaction(async (tx) => {
    const [cur] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, input.id), eq(accounts.ownerId, owner.ownerId)))
      .for("update");
    if (!cur) throw notFound("Account");
    if (cur.version !== input.version) throw stale();

    const openingChanged = cur.openingBalancePaise !== input.openingBalance || cur.openingDate !== input.openingDate;
    if (openingChanged && !input.confirmOpeningChange) {
      throw new ServiceError(
        "needs_confirmation",
        "Changing the opening balance or date changes this account's balance from the start. It is not income or spending. Confirm to continue.",
      );
    }
    if (input.openingDate > cur.openingDate) {
      const early = await tx.execute<{ d: string }>(sql`
        SELECT min(txn_date)::text AS d FROM transactions
        WHERE owner_id = ${owner.ownerId} AND (account_id = ${input.id} OR to_account_id = ${input.id})`);
      const first = early.rows[0]?.d;
      if (first && first < input.openingDate)
        throw validation(`There are entries from ${first}. The opening date must be on or before the first entry.`, {
          openingDate: `Must be on or before ${first}`,
        });
    }
    await tx
      .update(accounts)
      .set({
        name: input.name,
        kind: input.kind,
        openingBalancePaise: input.openingBalance,
        openingDate: input.openingDate,
        version: cur.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.id, input.id), eq(accounts.ownerId, owner.ownerId), eq(accounts.version, input.version)));
    if (openingChanged) {
      await tx.insert(openingChanges).values({
        ownerId: owner.ownerId,
        subjectType: "account",
        subjectId: input.id,
        oldPaise: cur.openingBalancePaise,
        newPaise: input.openingBalance,
        oldDate: cur.openingDate,
        newDate: input.openingDate,
      });
    }
  });
}

export async function setAccountArchived(db: DB, owner: OwnerContext, id: string, archived: boolean): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound("Account");
  const res = await db
    .update(accounts)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date(), version: sql`${accounts.version} + 1` })
    .where(and(eq(accounts.id, id), eq(accounts.ownerId, owner.ownerId)))
    .returning({ id: accounts.id });
  if (!res.length) throw notFound("Account");
}

/** Deletes an account only if nothing references it. Otherwise asks to archive. */
export async function deleteAccount(db: DB, owner: OwnerContext, id: string): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound("Account");
  await db.transaction(async (tx) => {
    const used = await tx.execute(sql`
      SELECT 1 FROM transactions WHERE owner_id = ${owner.ownerId} AND (account_id = ${id} OR to_account_id = ${id}) LIMIT 1`);
    if (used.rows.length) throw new ServiceError("conflict", "This account has entries, so it cannot be deleted. Archive it instead to keep its history.");
    await tx.delete(openingChanges).where(and(eq(openingChanges.ownerId, owner.ownerId), eq(openingChanges.subjectId, id)));
    const res = await tx.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.ownerId, owner.ownerId))).returning({ id: accounts.id });
    if (!res.length) throw notFound("Account");
  });
}

export async function listOpeningChanges(db: Exec, owner: OwnerContext, subjectType: "account" | "person", subjectId: string) {
  const rows = await db
    .select()
    .from(openingChanges)
    .where(and(eq(openingChanges.ownerId, owner.ownerId), eq(openingChanges.subjectType, subjectType), eq(openingChanges.subjectId, subjectId)))
    .orderBy(asc(openingChanges.changedAt));
  return rows.map((r) => ({
    id: r.id,
    oldPaise: r.oldPaise.toString(),
    newPaise: r.newPaise.toString(),
    oldDate: r.oldDate,
    newDate: r.newDate,
    changedAt: r.changedAt.toISOString(),
  }));
}
