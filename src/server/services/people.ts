import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { openingChanges, people } from "../db/schema";
import type { DB } from "../db/client";
import type { OwnerContext } from "../auth/owner";
import { IOU_DELTA, iouTotals, personNets, type Exec } from "./ledger-sql";
import { personInput, uuid } from "./validators";
import { notFound, ServiceError, stale, validation } from "./errors";
import { parseOrThrow } from "./util";
import { ownerToday } from "./settings";
import type { TxnType } from "@/lib/txn-types";
import { isPersonColor, pickNewPersonColor } from "@/lib/person-color";

export type PersonDTO = {
  id: string;
  name: string;
  label: string | null;
  color: string | null;
  openingIouPaise: string;
  openingDate: string;
  netPaise: string;
  archived: boolean;
  version: number;
  lastEntryDate: string | null;
};

export type PeopleFilter = "all" | "owes_me" | "i_owe" | "settled";

export async function listPeople(
  db: Exec,
  owner: OwnerContext,
  opts: { includeArchived?: boolean; filter?: PeopleFilter; q?: string } = {},
): Promise<PersonDTO[]> {
  const q = opts.q?.trim();
  const res = await db.execute<{
    id: string; name: string; label: string | null; color: string | null; opening: string; opening_date: string;
    net: string; archived: boolean; version: number; last_date: string | null;
  }>(sql`
    SELECT p.id, p.name, p.label, p.color, p.opening_iou_paise::text AS opening, p.opening_date::text AS opening_date,
      (p.opening_iou_paise + COALESCE(SUM(${IOU_DELTA}), 0))::text AS net,
      (p.archived_at IS NOT NULL) AS archived, p.version, max(t.txn_date)::text AS last_date
    FROM people p
    LEFT JOIN transactions t ON t.owner_id = p.owner_id AND t.person_id = p.id
    WHERE p.owner_id = ${owner.ownerId}
      ${opts.includeArchived ? sql`` : sql`AND p.archived_at IS NULL`}
      ${q ? sql`AND (p.name ILIKE ${"%" + escapeLike(q) + "%"} ESCAPE '\\' OR p.label ILIKE ${"%" + escapeLike(q) + "%"} ESCAPE '\\')` : sql``}
    GROUP BY p.id
    ORDER BY p.archived_at NULLS FIRST, lower(p.name), lower(p.label) NULLS FIRST, p.created_at, p.id`);
  let rows = res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    label: r.label,
    color: r.color,
    openingIouPaise: r.opening,
    openingDate: r.opening_date,
    netPaise: r.net,
    archived: r.archived,
    version: r.version,
    lastEntryDate: r.last_date,
  }));
  const f = opts.filter ?? "all";
  if (f !== "all") {
    rows = rows.filter((p) => {
      const n = BigInt(p.netPaise);
      return f === "owes_me" ? n > 0n : f === "i_owe" ? n < 0n : n === 0n;
    });
  }
  return rows;
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export async function getIouTotals(db: Exec, owner: OwnerContext) {
  const nets = await personNets(db, owner.ownerId);
  return iouTotals(nets.values());
}

export type PersonHistoryEntry = {
  id: string;
  type: TxnType;
  amountPaise: string;
  date: string;
  note: string | null;
  accountName: string;
  deltaPaise: string;
  runningPaise: string;
  version: number;
};

export async function getPersonDetail(db: Exec, owner: OwnerContext, id: string) {
  if (!uuid.safeParse(id).success) throw notFound("Person");
  const list = await listPeople(db, owner, { includeArchived: true });
  const person = list.find((p) => p.id === id);
  if (!person) throw notFound("Person");
  const res = await db.execute<{
    id: string; type: TxnType; amount: string; date: string; note: string | null; account_name: string; delta: string; version: number;
  }>(sql`
    SELECT t.id, t.type, t.amount_paise::text AS amount, t.txn_date::text AS date, t.note, a.name AS account_name,
      (${IOU_DELTA})::text AS delta, t.version
    FROM transactions t JOIN accounts a ON a.id = t.account_id AND a.owner_id = t.owner_id
    WHERE t.owner_id = ${owner.ownerId} AND t.person_id = ${id}
    ORDER BY t.txn_date, t.created_at, t.id`);
  let running = BigInt(person.openingIouPaise);
  const history: PersonHistoryEntry[] = res.rows.map((r) => {
    running += BigInt(r.delta);
    return {
      id: r.id,
      type: r.type,
      amountPaise: r.amount,
      date: r.date,
      note: r.note,
      accountName: r.account_name,
      deltaPaise: r.delta,
      runningPaise: running.toString(),
      version: r.version,
    };
  });
  return { person, history: history.reverse() };
}

export async function createPerson(db: DB, owner: OwnerContext, raw: unknown): Promise<{ id: string }> {
  const input = parseOrThrow(personInput, raw);
  const today = await ownerToday(db, owner);
  if (input.openingDate > today) throw validation("The as-of date cannot be in the future.", { openingDate: "Cannot be in the future" });
  const [row] = await db
    .insert(people)
    .values({ ownerId: owner.ownerId, name: input.name, label: input.label ?? null, color: await newPersonColor(db, owner), openingIouPaise: input.openingIou, openingDate: input.openingDate })
    .returning({ id: people.id });
  return row;
}

const updateSchema = personInput.extend({
  id: uuid,
  version: z.coerce.number().int().positive(),
  confirmOpeningChange: z.boolean().optional(),
});

export async function updatePerson(db: DB, owner: OwnerContext, raw: unknown): Promise<void> {
  const input = parseOrThrow(updateSchema, raw);
  const today = await ownerToday(db, owner);
  if (input.openingDate > today) throw validation("The as-of date cannot be in the future.", { openingDate: "Cannot be in the future" });
  await db.transaction(async (tx) => {
    const [cur] = await tx
      .select()
      .from(people)
      .where(and(eq(people.id, input.id), eq(people.ownerId, owner.ownerId)))
      .for("update");
    if (!cur) throw notFound("Person");
    if (cur.version !== input.version) throw stale();
    const openingChanged = cur.openingIouPaise !== input.openingIou || cur.openingDate !== input.openingDate;
    if (openingChanged && !input.confirmOpeningChange)
      throw new ServiceError(
        "needs_confirmation",
        "Changing the opening amount or date changes this person's balance from the start. No new entry is created. Confirm to continue.",
      );
    if (input.openingDate > cur.openingDate) {
      const early = await tx.execute<{ d: string }>(sql`
        SELECT min(txn_date)::text AS d FROM transactions WHERE owner_id = ${owner.ownerId} AND person_id = ${input.id}`);
      const first = early.rows[0]?.d;
      if (first && first < input.openingDate)
        throw validation(`There are entries from ${first}. The as-of date must be on or before the first entry.`, {
          openingDate: `Must be on or before ${first}`,
        });
    }
    await tx
      .update(people)
      .set({
        name: input.name,
        label: input.label ?? null,
        openingIouPaise: input.openingIou,
        openingDate: input.openingDate,
        version: cur.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(people.id, input.id), eq(people.ownerId, owner.ownerId), eq(people.version, input.version)));
    if (openingChanged)
      await tx.insert(openingChanges).values({
        ownerId: owner.ownerId,
        subjectType: "person",
        subjectId: input.id,
        oldPaise: cur.openingIouPaise,
        newPaise: input.openingIou,
        oldDate: cur.openingDate,
        newDate: input.openingDate,
      });
  });
}

export async function setPersonArchived(db: DB, owner: OwnerContext, id: string, archived: boolean): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound("Person");
  const res = await db
    .update(people)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date(), version: sql`${people.version} + 1` })
    .where(and(eq(people.id, id), eq(people.ownerId, owner.ownerId)))
    .returning({ id: people.id });
  if (!res.length) throw notFound("Person");
}

export async function deletePerson(db: DB, owner: OwnerContext, id: string): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound("Person");
  await db.transaction(async (tx) => {
    const used = await tx.execute(sql`SELECT 1 FROM transactions WHERE owner_id = ${owner.ownerId} AND person_id = ${id} LIMIT 1`);
    if (used.rows.length) throw new ServiceError("conflict", "This person has entries, so they cannot be deleted. Archive them instead to keep the history.");
    await tx.delete(openingChanges).where(and(eq(openingChanges.ownerId, owner.ownerId), eq(openingChanges.subjectId, id)));
    const res = await tx.delete(people).where(and(eq(people.id, id), eq(people.ownerId, owner.ownerId))).returning({ id: people.id });
    if (!res.length) throw notFound("Person");
  });
}

/** Removes a person together with all of their transactions. Balances are derived, so they update on their own. */
export async function removePerson(db: DB, owner: OwnerContext, id: string): Promise<{ deletedEntries: number }> {
  if (!uuid.safeParse(id).success) throw notFound("Person");
  return db.transaction(async (tx) => {
    const found = await tx.select({ id: people.id }).from(people).where(and(eq(people.id, id), eq(people.ownerId, owner.ownerId))).for("update");
    if (!found.length) throw notFound("Person");
    const entries = await tx.execute(sql`DELETE FROM transactions WHERE owner_id = ${owner.ownerId} AND person_id = ${id} RETURNING id`);
    await tx.delete(openingChanges).where(and(eq(openingChanges.ownerId, owner.ownerId), eq(openingChanges.subjectId, id)));
    await tx.delete(people).where(and(eq(people.id, id), eq(people.ownerId, owner.ownerId)));
    return { deletedEntries: entries.rows.length };
  });
}

/** Picks a colour tag that the owner's active people use least, so people look different. */
export async function newPersonColor(db: Exec, owner: OwnerContext): Promise<string> {
  const res = await db.execute<{ color: string | null }>(sql`SELECT color FROM people WHERE owner_id = ${owner.ownerId} AND archived_at IS NULL`);
  return pickNewPersonColor(res.rows.map((r) => r.color));
}

/** Changes a person's colour tag. Only colours from the app palette are allowed. */
export async function setPersonColor(db: DB, owner: OwnerContext, raw: unknown): Promise<void> {
  const input = parseOrThrow(z.object({ id: uuid, color: z.string().refine(isPersonColor, { message: "Choose one of the colours." }) }), raw);
  const res = await db
    .update(people)
    .set({ color: input.color, updatedAt: new Date() })
    .where(and(eq(people.id, input.id), eq(people.ownerId, owner.ownerId)))
    .returning({ id: people.id });
  if (!res.length) throw notFound("Person");
}
