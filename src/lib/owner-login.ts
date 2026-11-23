// Shared by the login form and the server. Better Auth signs in by email, but the
// owner signs in with ADMIN_USERNAME. A plain username maps to a fixed internal
// address on the reserved ".invalid" domain (it can never receive mail).
// A username that already looks like an email is used as-is; anything else works too.
export const OWNER_EMAIL_DOMAIN = "owner.invalid";

export function ownerEmailFromUsername(username: string): string {
  const u = username.trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return u;
  return `${u.replace(/[^a-z0-9._-]/g, "-")}@${OWNER_EMAIL_DOMAIN}`;
}

/** Shows the username form of an internal owner address. */
export function displayUsername(email: string): string {
  return email.endsWith(`@${OWNER_EMAIL_DOMAIN}`) ? email.slice(0, -OWNER_EMAIL_DOMAIN.length - 1) : email;
}
