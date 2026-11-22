import { z } from "zod";
import { parseRupees } from "@/lib/money";
import { isValidLocalDate } from "@/lib/dates";
import { PAYMENT_METHODS, TXN_TYPES } from "@/lib/txn-types";

export const uuid = z.uuid({ message: "Invalid reference." });

const optionalUuid = z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional());

export const localDate = z.string().refine(isValidLocalDate, { message: "Enter a valid date." });

/** Positive amount in rupees as a string, converted to paise. */
export const amountRupees = z.string().transform((v, ctx) => {
  const r = parseRupees(v);
  if (!r.ok) {
    ctx.addIssue({ code: "custom", message: r.error });
    return z.NEVER;
  }
  return r.paise;
});

/** Signed amount (opening balances/IOUs). Zero allowed. */
export const signedRupees = z.string().transform((v, ctx) => {
  const r = parseRupees(v === "" ? "0" : v, { allowZero: true, allowNegative: true });
  if (!r.ok) {
    ctx.addIssue({ code: "custom", message: r.error });
    return z.NEVER;
  }
  return r.paise;
});

const trimmedOptional = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v),
    z.string().max(max, { message: `Keep it under ${max} characters.` }).optional(),
  );

export const name = (max: number) =>
  z.string().trim().min(1, { message: "Enter a name." }).max(max, { message: `Keep it under ${max} characters.` });

export const transactionInput = z.object({
  type: z.enum(TXN_TYPES),
  amount: amountRupees,
  date: localDate,
  accountId: uuid,
  toAccountId: optionalUuid,
  categoryId: optionalUuid,
  personId: optionalUuid,
  note: trimmedOptional(500),
  paymentMethod: z.preprocess((v) => (v === "" ? undefined : v), z.enum(PAYMENT_METHODS).optional()),
  idempotencyKey: z.string().min(8).max(200).regex(/^[A-Za-z0-9:_\-]+$/),
  confirmCrossZero: z.boolean().optional(),
});
export type TransactionInput = z.infer<typeof transactionInput>;

export const accountInput = z.object({
  name: name(60),
  kind: z.enum(["cash", "bank", "wallet"]),
  openingBalance: signedRupees,
  openingDate: localDate,
});

export const personInput = z.object({
  name: name(60),
  label: trimmedOptional(40),
  openingIou: signedRupees,
  openingDate: localDate,
});

export const categoryInput = z.object({
  name: name(40),
  kind: z.enum(["expense", "income"]),
});

export function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
