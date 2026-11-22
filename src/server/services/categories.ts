import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { categories } from "../db/schema";
import type { DB } from "../db/client";
import type { OwnerContext } from "../auth/owner";
import type { Exec } from "./ledger-sql";
import { categoryInput, name, uuid } from "./validators";
import { notFound, ServiceError } from "./errors";
import { parseOrThrow } from "./util";
import { z } from "zod";

export type CategoryDTO = { id: string; name: string; kind: "expense" | "income"; archived: boolean; useCount: number };

export async function listCategories(db: Exec, owner: OwnerContext, opts: { includeArchived?: boolean } = {}): Promise<CategoryDTO[]> {
  const res = await db.execute<{ id: string; name: string; kind: "expense" | "income"; archived: boolean; use_count: string }>(sql`
    SELECT c.id, c.name, c.kind, (c.archived_at IS NOT NULL) AS archived,
      (SELECT count(*) FROM transactions t WHERE t.owner_id = c.owner_id AND t.category_id = c.id
         AND t.txn_date >= current_date - 90)::text AS use_count
    FROM categories c
    WHERE c.owner_id = ${owner.ownerId} ${opts.includeArchived ? sql`` : sql`AND c.archived_at IS NULL`}
    ORDER BY c.archived_at NULLS FIRST, c.kind, lower(c.name)`);
  return res.rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, archived: r.archived, useCount: Number(r.use_count) }));
}

export async function createCategory(db: DB, owner: OwnerContext, raw: unknown): Promise<{ id: string }> {
  const input = parseOrThrow(categoryInput, raw);
  const [row] = await db.insert(categories).values({ ownerId: owner.ownerId, ...input }).returning({ id: categories.id });
  return row;
}

export async function renameCategory(db: DB, owner: OwnerContext, raw: unknown): Promise<void> {
  const input = parseOrThrow(z.object({ id: uuid, name: name(40) }), raw);
  const res = await db
    .update(categories)
    .set({ name: input.name, updatedAt: new Date() })
    .where(and(eq(categories.id, input.id), eq(categories.ownerId, owner.ownerId)))
    .returning({ id: categories.id });
  if (!res.length) throw notFound("Category");
}

export async function setCategoryArchived(db: DB, owner: OwnerContext, id: string, archived: boolean): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound("Category");
  const res = await db
    .update(categories)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(categories.id, id), eq(categories.ownerId, owner.ownerId)))
    .returning({ id: categories.id });
  if (!res.length) throw notFound("Category");
}

export async function deleteCategory(db: DB, owner: OwnerContext, id: string): Promise<void> {
  if (!uuid.safeParse(id).success) throw notFound("Category");
  const used = await db.execute(sql`
    SELECT 1 FROM transactions WHERE owner_id = ${owner.ownerId} AND category_id = ${id}
    UNION ALL SELECT 1 FROM budget_category_limits WHERE owner_id = ${owner.ownerId} AND category_id = ${id} LIMIT 1`);
  if (used.rows.length) throw new ServiceError("conflict", "This category is used by entries or budgets. Archive it instead to keep history.");
  const res = await db
    .delete(categories)
    .where(and(eq(categories.id, id), eq(categories.ownerId, owner.ownerId)))
    .returning({ id: categories.id });
  if (!res.length) throw notFound("Category");
}

export async function activeCategoryIds(db: Exec, owner: OwnerContext) {
  return db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.ownerId, owner.ownerId), isNull(categories.archivedAt)))
    .orderBy(asc(categories.name));
}
