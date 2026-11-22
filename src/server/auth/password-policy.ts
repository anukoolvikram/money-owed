import { dictionary } from "@zxcvbn-ts/language-common";

// Passphrase policy (OWASP / NIST 800-63B style for password-only login):
// - at least 15 characters, up to 128 allowed (we never truncate)
// - spaces, Unicode and paste are allowed; no composition rules
// - reject common passwords using the maintained zxcvbn-ts common list
//   (@zxcvbn-ts/language-common, MIT), including padded/repeated variants.
export const MIN_PASSWORD_LENGTH = 15;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON: Set<string> = new Set(
  (dictionary["passwords-common"] as string[]).map((p) => p.toLowerCase()),
);
const EXTRA = ["personal ledger", "personalledger", "moneytrack", "money track", "passphrase"];
for (const e of EXTRA) COMMON.add(e);

function normalise(p: string): string {
  return p.normalize("NFKC").toLowerCase();
}

function isRepetitionOfCommon(s: string): boolean {
  for (let len = 1; len <= Math.floor(s.length / 2); len++) {
    if (s.length % len !== 0) continue;
    const unit = s.slice(0, len);
    if (unit.repeat(s.length / len) === s && (len < 4 || COMMON.has(unit))) return true;
  }
  return false;
}

export type PolicyResult = { ok: true } | { ok: false; error: string };

/** Counts user-perceived characters (code points), not UTF-16 units. */
export function passwordLength(p: string): number {
  return [...p].length;
}

export function checkPassphrase(password: unknown, context: { email?: string } = {}): PolicyResult {
  if (typeof password !== "string") return { ok: false, error: "Enter a passphrase." };
  const len = passwordLength(password);
  if (len < MIN_PASSWORD_LENGTH)
    return { ok: false, error: `Use at least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words with spaces works well.` };
  if (len > MAX_PASSWORD_LENGTH) return { ok: false, error: `Use at most ${MAX_PASSWORD_LENGTH} characters.` };

  const n = normalise(password);
  const compact = n.replace(/[\s\-_.]+/g, "");
  const core = compact.replace(/^[^a-z]+|[^a-z]+$/g, ""); // strip leading/trailing digits & symbols
  if (COMMON.has(n) || COMMON.has(compact) || (core.length > 0 && COMMON.has(core)))
    return { ok: false, error: "This passphrase is too common. Choose something less predictable." };
  if (isRepetitionOfCommon(compact))
    return { ok: false, error: "Avoid repeating the same word or pattern." };
  if (new Set([...compact]).size < 6)
    return { ok: false, error: "Use more varied characters." };

  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && compact.includes(local.replace(/[\s\-_.]+/g, "")))
    return { ok: false, error: "Don't include your email address in the passphrase." };
  return { ok: true };
}
