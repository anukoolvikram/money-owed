// The seven MVP transaction types and their effects. Shared by server and UI.

export const TXN_TYPES = [
  "expense",
  "income",
  "transfer",
  "lend",
  "borrow",
  "repayment_received",
  "repayment_paid",
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const IOU_TYPES = ["lend", "borrow", "repayment_received", "repayment_paid"] as const;
export type IouType = (typeof IOU_TYPES)[number];

export function isIouType(t: TxnType): t is IouType {
  return (IOU_TYPES as readonly string[]).includes(t);
}
export function isCategoryType(t: TxnType): t is "expense" | "income" {
  return t === "expense" || t === "income";
}

/** Plain-language labels used in the add form and history. */
export const TXN_LABELS: Record<TxnType, { short: string; action: string; history: string }> = {
  expense: { short: "Expense", action: "I spent", history: "Expense" },
  income: { short: "Income", action: "I earned", history: "Income" },
  transfer: { short: "Transfer", action: "I moved money", history: "Transfer" },
  lend: { short: "Lent", action: "I lent", history: "Lent to" },
  borrow: { short: "Borrowed", action: "I borrowed", history: "Borrowed from" },
  repayment_received: { short: "Repaid me", action: "They repaid me", history: "Repaid by" },
  repayment_paid: { short: "I repaid", action: "I repaid them", history: "Repaid to" },
};

/**
 * Sign of the effect on the (source) account balance: +1 money in, -1 money out.
 * A transfer is -1 for the source and +1 for the destination.
 */
export const ACCOUNT_EFFECT: Record<TxnType, 1 | -1> = {
  expense: -1,
  income: 1,
  transfer: -1,
  lend: -1,
  borrow: 1,
  repayment_received: 1,
  repayment_paid: -1,
};

/**
 * Effect on a person's net IOU. Positive = they owe me more.
 * net = opening + lent + repayments_paid - borrowed - repayments_received
 */
export const IOU_EFFECT: Record<IouType, 1 | -1> = {
  lend: 1,
  repayment_paid: 1,
  borrow: -1,
  repayment_received: -1,
};

/** Signed change to a person's IOU for one entry. */
export function iouDelta(type: TxnType, amountPaise: bigint): bigint {
  if (!isIouType(type)) return 0n;
  return IOU_EFFECT[type] === 1 ? amountPaise : -amountPaise;
}

/** Signed change to one account for one entry. */
export function accountDelta(
  t: { type: TxnType; amountPaise: bigint; accountId: string; toAccountId: string | null },
  accountId: string,
): bigint {
  let d = 0n;
  if (t.accountId === accountId) d += ACCOUNT_EFFECT[t.type] === 1 ? t.amountPaise : -t.amountPaise;
  if (t.type === "transfer" && t.toAccountId === accountId) d += t.amountPaise;
  return d;
}

export const PAYMENT_METHODS = ["cash", "upi", "card", "netbanking", "wallet", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Debit card",
  netbanking: "Net banking",
  wallet: "Wallet",
  other: "Other",
};

/** Describes a signed IOU balance in plain words. */
export function describeIou(net: bigint): "owes_me" | "i_owe" | "settled" {
  if (net > 0n) return "owes_me";
  if (net < 0n) return "i_owe";
  return "settled";
}
