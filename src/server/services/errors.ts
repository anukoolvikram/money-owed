// Safe, user-facing errors. Anything else is logged generically and shown as
// "Something went wrong" — database errors never reach the browser.

export type ServiceErrorCode =
  | "validation"
  | "not_found"
  | "conflict"
  | "stale"
  | "needs_confirmation"
  | "unauthorized"
  | "limit";

export class ServiceError extends Error {
  constructor(
    public code: ServiceErrorCode,
    message: string,
    public fieldErrors: Record<string, string> = {},
    public details?: Record<string, string>,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export const validation = (message: string, fieldErrors: Record<string, string> = {}) =>
  new ServiceError("validation", message, fieldErrors);
export const notFound = (what = "Item") => new ServiceError("not_found", `${what} not found.`);
export const stale = () =>
  new ServiceError("stale", "This item was changed in another tab or device. Reload to see the latest version, then try again.");

/** Maps Postgres constraint errors to safe messages without exposing internals. */
export function mapDbError(e: unknown): ServiceError | undefined {
  const code = (e as { code?: string })?.code;
  const constraint = (e as { constraint?: string })?.constraint ?? "";
  if (code === "23505") {
    if (constraint.includes("categories_owner_kind_name")) return validation("A category with that name already exists.", { name: "Already exists" });
    return new ServiceError("conflict", "That item already exists.");
  }
  if (code === "23503") return new ServiceError("conflict", "This item is used by other records, so it cannot be removed. Archive it instead.");
  if (code === "23514") return validation("Some values are not allowed. Check the form and try again.");
  return undefined;
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | {
      ok: false;
      code: ServiceErrorCode | "error";
      message: string;
      fieldErrors?: Record<string, string>;
      details?: Record<string, string>;
    };

/** Converts any thrown error into a safe ActionResult. Logs without sensitive data. */
export function toActionError(e: unknown): Extract<ActionResult, { ok: false }> {
  const se = e instanceof ServiceError ? e : mapDbError(e);
  if (se) return { ok: false, code: se.code, message: se.message, fieldErrors: se.fieldErrors, details: se.details };
  if ((e as Error)?.name === "UnauthorizedError")
    return { ok: false, code: "unauthorized", message: "Your session has ended. Please sign in again." };
  const pgCode = (e as { code?: string })?.code;
  console.error(`[action] unexpected error${pgCode ? ` (pg ${pgCode})` : ""}: ${(e as Error)?.name ?? "unknown"}`);
  return { ok: false, code: "error", message: "Something went wrong. Nothing was saved. Please try again." };
}
