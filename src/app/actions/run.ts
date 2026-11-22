import "server-only";
import { refresh } from "next/cache";
import { requireOwner } from "@/server/auth/guard";
import type { OwnerContext } from "@/server/auth/owner";
import { db } from "@/server/db/client";
import type { DB } from "@/server/db/client";
import { assertSameOrigin } from "@/server/http";
import { toActionError, type ActionResult } from "@/server/services/errors";

/**
 * Wraps every mutation: same-origin check -> owner guard -> service call ->
 * safe result. Owner identity always comes from the validated session.
 */
export async function runAction<T>(
  fn: (db: DB, owner: OwnerContext) => Promise<T>,
  opts: { refresh?: boolean; message?: string } = {},
): Promise<ActionResult<T>> {
  try {
    await assertSameOrigin();
    const owner = await requireOwner();
    const data = await fn(db(), owner);
    if (opts.refresh !== false) refresh();
    return { ok: true, data, message: opts.message };
  } catch (e) {
    return toActionError(e);
  }
}
