// No strength rules: any non-empty password up to MAX_PASSWORD_LENGTH is accepted.
export const MIN_PASSWORD_LENGTH = 1;
export const MAX_PASSWORD_LENGTH = 128;

export type PolicyResult = { ok: true } | { ok: false; error: string };

export function checkPassphrase(password: unknown): PolicyResult {
  if (typeof password !== "string" || password.length === 0) return { ok: false, error: "Enter a password." };
  if (password.length > MAX_PASSWORD_LENGTH) return { ok: false, error: `Use at most ${MAX_PASSWORD_LENGTH} characters.` };
  return { ok: true };
}
