import type { z } from "zod";
import { validation } from "./errors";
import { zodFieldErrors } from "./validators";

export { validation };

export function zodFieldErrorsSafe(err: z.ZodError): Record<string, string> {
  return zodFieldErrors(err);
}

export function parseOrThrow<T extends z.ZodType>(schema: T, raw: unknown, message = "Check the highlighted fields."): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) throw validation(message, zodFieldErrors(r.error));
  return r.data;
}

export function paiseStr(v: bigint | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "bigint" ? v.toString() : v;
}
