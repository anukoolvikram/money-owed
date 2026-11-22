// Exact money handling. All amounts are integer paise held as BigInt.
// Safe to import from both server and browser code (no secrets, no I/O).

/** ₹1,000 crore. Matches the CHECK constraints in the database schema. */
export const MAX_PAISE = 1_000_000_000_000n;
export const MAX_RUPEES_LABEL = "₹1,000 crore";

export type MoneyParseResult = { ok: true; paise: bigint } | { ok: false; error: string };

const DECIMAL_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parses a user-entered rupee amount (string) into paise without floating point.
 * Accepts "1500", "1,500.50", "₹ 0.3". Rejects exponents, NaN, >2 decimals,
 * negatives (unless allowNegative), zero (unless allowZero) and overflow.
 */
export function parseRupees(
  input: unknown,
  opts: { allowZero?: boolean; allowNegative?: boolean } = {},
): MoneyParseResult {
  if (typeof input !== "string") return { ok: false, error: "Enter an amount." };
  let s = input.trim().replace(/^₹\s*/, "").replace(/\s+/g, "");
  if (s === "") return { ok: false, error: "Enter an amount." };

  let negative = false;
  if (s.startsWith("-")) {
    if (!opts.allowNegative) return { ok: false, error: "Amount must be positive." };
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  // Allow Indian (1,00,000) or international (100,000) grouping, but only in the integer part.
  if (s.includes(",")) {
    const [intPart, ...rest] = s.split(".");
    if (rest.length > 1 || !/^(\d{1,3}(,\d{3})+|\d{1,2}(,\d{2})*,\d{3})$/.test(intPart)) {
      return { ok: false, error: "Use digits with at most one decimal point." };
    }
    s = intPart.replace(/,/g, "") + (rest.length ? "." + rest[0] : "");
  }

  if (/[eE]/.test(s)) return { ok: false, error: "Scientific notation is not allowed." };
  if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: "Use at most two decimal places." };
  const m = DECIMAL_RE.exec(s);
  if (!m) return { ok: false, error: "Enter a valid amount, like 250 or 99.50." };
  if (m[1].length > 15) return { ok: false, error: `Amount is above the supported maximum of ${MAX_RUPEES_LABEL}.` };

  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(2, "0"));
  let paise = whole * 100n + frac;
  if (paise > MAX_PAISE) return { ok: false, error: `Amount is above the supported maximum of ${MAX_RUPEES_LABEL}.` };
  if (negative) paise = -paise;
  if (paise === 0n && !opts.allowZero) return { ok: false, error: "Amount must be more than zero." };
  if (paise === 0n) paise = 0n; // normalise -0
  return { ok: true, paise };
}

/** Plain decimal string for form fields, e.g. 150050n -> "1500.50", 0n -> "0". */
export function paiseToInput(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const whole = abs / 100n;
  const frac = abs % 100n;
  const s = frac === 0n ? whole.toString() : `${whole}.${frac.toString().padStart(2, "0")}`;
  return neg ? "-" + s : s;
}

/** Indian digit grouping: 12345678 -> "1,23,45,678". */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

/** Formats paise as INR with Indian grouping: 1234567n -> "₹12,345.67". Exact, no floats. */
export function formatINR(paise: bigint, opts: { sign?: "auto" | "always" | "never" } = {}): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const whole = groupIndian((abs / 100n).toString());
  const frac = (abs % 100n).toString().padStart(2, "0");
  const body = `₹${whole}.${frac}`;
  const sign = opts.sign ?? "auto";
  if (sign === "never") return body;
  if (neg) return "−" + body; // U+2212 minus for readability
  if (sign === "always" && abs > 0n) return "+" + body;
  return body;
}

// ---- JSON-safe transport: BigInt cannot be JSON.stringified, so we send strings. ----

export type PaiseString = string & { readonly __paise: unique symbol };

export function toPaiseString(p: bigint): PaiseString {
  return p.toString() as PaiseString;
}

export function fromPaiseString(s: string): bigint {
  if (!/^-?\d{1,16}$/.test(s)) throw new Error("Invalid paise string");
  return BigInt(s);
}

export function sumPaise(values: Iterable<bigint>): bigint {
  let t = 0n;
  for (const v of values) t += v;
  return t;
}
