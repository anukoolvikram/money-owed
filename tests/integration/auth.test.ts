import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createHarness, makeOwner, makeStrayUser, resetAll, TEST_EMAIL, TEST_PASSWORD, type Harness } from "../helpers/db";
import { createAuth } from "@/server/auth/config";
import { resolveOwner } from "@/server/auth/owner";
import { provisionOwner, recoverOwner, setOwnerDisabled, AdminError } from "@/server/admin/owner-admin";

let h: Harness;
const ORIGIN = () => process.env.BETTER_AUTH_URL!;

function req(auth: ReturnType<typeof createAuth>, path: string, init: { body?: unknown; cookie?: string; origin?: string | null; headers?: Record<string, string>; method?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers ?? {}) };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN();
  if (init.cookie) headers.cookie = init.cookie;
  return auth.handler(
    new Request(`${ORIGIN()}/api/auth${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
  );
}

function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function signIn(auth = h.auth, email = TEST_EMAIL, password = TEST_PASSWORD, headers: Record<string, string> = {}) {
  return req(auth, "/sign-in/email", { body: { email, password }, headers });
}

async function sessionOwner(cookie: string, auth = h.auth) {
  const s = await auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true } });
  if (!s) return null;
  return resolveOwner(h.db, s.user.id, s.session.id);
}

beforeAll(() => {
  h = createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await resetAll(h);
});

describe("14. sign-up and provisioning", () => {
  it("public sign-up is rejected over HTTP, not just hidden", async () => {
    const res = await req(h.auth, "/sign-up/email", { body: { email: "x@example.test", password: "another long passphrase", name: "X" } });
    expect(res.status).toBe(404);
    // Even the server API refuses because disableSignUp is set.
    await expect(h.auth.api.signUpEmail({ body: { email: "x@example.test", password: "another long passphrase", name: "X" } })).rejects.toThrow();
    const users = await h.adminDb.execute(sql`SELECT count(*)::int AS n FROM "user"`);
    expect(users.rows[0]).toEqual({ n: 0 });
  });

  it("reset/verification/user-management endpoints are not exposed", async () => {
    for (const p of ["/request-password-reset", "/reset-password", "/update-user", "/delete-user", "/change-email", "/list-accounts", "/sign-in/social"]) {
      const res = await req(h.auth, p, { body: {} });
      expect(res.status, p).toBe(404);
    }
  });

  it("only one owner can ever exist, even with racing provisioning", async () => {
    const deps = { db: h.adminDb, pool: h.adminPool, auth: h.adminAuth };
    const results = await Promise.allSettled(
      ["a@example.test", "b@example.test", "c@example.test"].map((email) => provisionOwner(deps, { email, password: TEST_PASSWORD })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const owners = await h.adminDb.execute(sql`SELECT count(*)::int AS n FROM app_owner`);
    expect(owners.rows[0]).toEqual({ n: 1 });
    const users = await h.adminDb.execute(sql`SELECT count(*)::int AS n FROM "user"`);
    expect(users.rows[0]).toEqual({ n: 1 }); // losers left no half-created users
    await expect(provisionOwner(deps, { email: "d@example.test", password: TEST_PASSWORD })).rejects.toBeInstanceOf(AdminError);
  });

  it("provisioning enforces the passphrase policy", async () => {
    const deps = { db: h.adminDb, pool: h.adminPool, auth: h.adminAuth };
    await expect(provisionOwner(deps, { email: "e@example.test", password: "short" })).rejects.toThrow(/15/);
    await expect(provisionOwner(deps, { email: "e@example.test", password: "123456789987654321" })).rejects.toThrow(/common/);
  });

  it("a non-owner account has no app access", async () => {
    await makeOwner(h);
    await makeStrayUser(h);
    const res = await signIn(h.auth, "stray@example.test");
    expect(res.status).toBe(200); // the auth library accepts it...
    expect(await sessionOwner(cookieFrom(res))).toBeNull(); // ...but the owner guard does not
  });
});

describe("15. sessions", () => {
  beforeEach(async () => {
    await makeOwner(h);
  });

  it("sets HttpOnly cookies and validates against the database", async () => {
    const res = await signIn();
    expect(res.status).toBe(200);
    const setCookie = res.headers.getSetCookie().join("\n");
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(await res.text()).not.toMatch(/password|hash/i);
    expect(await sessionOwner(cookieFrom(res))).not.toBeNull();
  });

  it("invalid and expired sessions fail", async () => {
    expect(await sessionOwner("ledger.session_token=forged.value")).toBeNull();
    const cookie = cookieFrom(await signIn());
    await h.adminDb.execute(sql`UPDATE session SET expires_at = now() - interval '1 minute'`);
    expect(await sessionOwner(cookie)).toBeNull();
  });

  it("session lifetime is finite (7 days) and does not slide", async () => {
    await signIn();
    const r = await h.adminDb.execute<{ secs: number }>(sql`SELECT EXTRACT(EPOCH FROM expires_at - created_at)::int AS secs FROM session`);
    expect(r.rows[0].secs).toBeGreaterThan(7 * 86400 - 60);
    expect(r.rows[0].secs).toBeLessThanOrEqual(7 * 86400 + 60);
  });

  it("logout and revoke-all invalidate sessions server-side", async () => {
    const c1 = cookieFrom(await signIn());
    const c2 = cookieFrom(await signIn());
    const out = await req(h.auth, "/sign-out", { body: {}, cookie: c1 });
    expect(out.status).toBe(200);
    expect(await sessionOwner(c1)).toBeNull();
    expect(await sessionOwner(c2)).not.toBeNull();
    const c3 = cookieFrom(await signIn());
    const rev = await req(h.auth, "/revoke-sessions", { body: {}, cookie: c3 });
    expect(rev.status).toBe(200);
    expect(await sessionOwner(c2)).toBeNull();
    expect(await sessionOwner(c3)).toBeNull();
  });

  it("change password verifies the current one, applies policy and revokes other sessions", async () => {
    const keep = cookieFrom(await signIn());
    const other = cookieFrom(await signIn());
    const bad = await req(h.auth, "/change-password", { body: { currentPassword: "wrong passphrase here!!", newPassword: "a brand new long passphrase", revokeOtherSessions: true }, cookie: keep });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const weak = await req(h.auth, "/change-password", { body: { currentPassword: TEST_PASSWORD, newPassword: "1qaz2wsx3edc4rfv", revokeOtherSessions: true }, cookie: keep });
    expect(weak.status).toBe(400);
    const good = await req(h.auth, "/change-password", { body: { currentPassword: TEST_PASSWORD, newPassword: "a brand new long passphrase", revokeOtherSessions: true }, cookie: keep });
    expect(good.status).toBe(200);
    expect(await sessionOwner(other)).toBeNull();
    expect((await signIn(h.auth, TEST_EMAIL, "a brand new long passphrase")).status).toBe(200);
  });

  it("terminal recovery resets the password and revokes every session", async () => {
    const c = cookieFrom(await signIn());
    await recoverOwner({ db: h.adminDb, auth: h.adminAuth }, { email: TEST_EMAIL, password: "recovered long passphrase" });
    expect(await sessionOwner(c)).toBeNull();
    expect((await signIn()).status).toBe(401);
    expect((await signIn(h.auth, TEST_EMAIL, "recovered long passphrase")).status).toBe(200);
    await expect(recoverOwner({ db: h.adminDb, auth: h.adminAuth }, { email: "nobody@example.test", password: "recovered long passphrase" })).rejects.toBeInstanceOf(AdminError);
  });

  it("a disabled or removed owner loses access through an old session", async () => {
    const c = cookieFrom(await signIn());
    expect(await sessionOwner(c)).not.toBeNull();
    await h.adminDb.execute(sql`UPDATE app_owner SET disabled_at = now()`);
    expect(await sessionOwner(c)).toBeNull();
    await setOwnerDisabled(h.adminDb, false);
    const c2 = cookieFrom(await signIn());
    await h.adminDb.execute(sql`DELETE FROM app_owner`);
    expect(await sessionOwner(c2)).toBeNull();
  });
});

describe("16-17. origin checks, throttling and generic errors", () => {
  beforeEach(async () => {
    await makeOwner(h);
  });

  it("rejects cross-origin cookie-authenticated writes", async () => {
    const cookie = cookieFrom(await signIn());
    const res = await req(h.auth, "/revoke-sessions", { body: {}, cookie, origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await sessionOwner(cookie)).not.toBeNull();
    const si = await req(h.auth, "/sign-in/email", { body: { email: TEST_EMAIL, password: TEST_PASSWORD }, origin: "https://evil.example" });
    expect(si.status).toBe(403);
  });

  it("uses the same generic message for unknown email and wrong password", async () => {
    const a = await signIn(h.auth, "nobody@example.test", "some long wrong passphrase");
    const b = await signIn(h.auth, TEST_EMAIL, "some long wrong passphrase");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    const [ja, jb] = [await a.json(), await b.json()];
    expect(ja.message).toBe(jb.message);
    expect(ja.message).not.toMatch(/not found|no user|exist/i);
  });

  it("per-account throttle is shared across two app instances and survives IP spoofing", async () => {
    const second = createAuth({ db: h.db, secret: process.env.BETTER_AUTH_SECRET!, baseURL: ORIGIN(), trustedOrigins: [ORIGIN()], production: false });
    for (let i = 0; i < 5; i++) {
      const inst = i % 2 ? second : h.auth;
      const r = await signIn(inst, TEST_EMAIL, "wrong passphrase attempt", { "x-forwarded-for": `203.0.113.${i}` });
      expect(r.status).toBe(401);
    }
    // 6th attempt, correct password, different instance and spoofed IP: still throttled.
    const blocked = await signIn(second, TEST_EMAIL, TEST_PASSWORD, { "x-forwarded-for": "198.51.100.7" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("x-retry-after")).toBeTruthy();
    // Same response for an unknown email under throttle: no enumeration.
    for (let i = 0; i < 5; i++) await signIn(h.auth, "ghost@example.test", "wrong passphrase attempt");
    expect((await signIn(h.auth, "ghost@example.test", "wrong passphrase attempt")).status).toBe(429);
    // Normalised: case/space variants hit the same bucket.
    expect((await signIn(h.auth, "  OWNER@example.TEST ", TEST_PASSWORD)).status).toBe(429);
    // Temporary, not permanent: expire the lock and sign-in works again.
    await h.adminDb.execute(sql`UPDATE login_throttle SET locked_until = now() - interval '1 second'`);
    // (We made 12 attempts from one local IP bucket, so also let the IP window pass.)
    await h.adminDb.execute(sql`DELETE FROM rate_limit`);
    expect((await signIn(second, TEST_EMAIL, TEST_PASSWORD)).status).toBe(200);
  });

  it("database-backed IP rate limit applies across instances", async () => {
    const second = createAuth({ db: h.db, secret: process.env.BETTER_AUTH_SECRET!, baseURL: ORIGIN(), trustedOrigins: [ORIGIN()], production: false });
    const statuses: number[] = [];
    // Different emails so the per-account throttle is not what stops us.
    for (let i = 0; i < 12; i++) {
      const r = await signIn(i % 2 ? second : h.auth, `user${i}@example.test`, "wrong passphrase attempt", { "x-forwarded-for": `192.0.2.${i}` });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    const rows = await h.adminDb.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM rate_limit`);
    expect(rows.rows[0].n).toBeGreaterThan(0);
  });
});
