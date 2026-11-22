import { sql } from "drizzle-orm";
import type { DB } from "../db/client";

export type OwnerContext = {
  /** Owner id derived from the validated session. Never taken from client input. */
  ownerId: string;
  sessionId: string;
  email: string;
};

/** Returns an owner context only if userId is the enabled singleton owner. */
export async function resolveOwner(db: DB, userId: string, sessionId: string): Promise<OwnerContext | null> {
  const res = await db.execute<{ user_id: string; email: string }>(sql`
    SELECT o.user_id, u.email FROM app_owner o JOIN "user" u ON u.id = o.user_id
    WHERE o.id = 1 AND o.user_id = ${userId} AND o.disabled_at IS NULL`);
  const row = res.rows[0];
  if (!row) return null;
  return { ownerId: row.user_id, sessionId, email: row.email };
}
