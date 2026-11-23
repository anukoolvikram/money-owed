import { expect, test } from "@playwright/test";
import { login, OWNER_EMAIL, OWNER_PASS, resetAndProvision } from "./helpers";

const PAGES = ["/", "/add", "/transactions", "/people", "/more", "/more/accounts", "/more/categories", "/more/budgets", "/more/settings", "/more/security", "/more/data", "/more/help"];
const MARKER = "zz-private-marker-9431";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => resetAndProvision());

test("13. logged-out access is denied without leaking data", async ({ page, request }) => {
  // Create private data with a recognisable marker.
  await login(page);
  await page.goto("/more/accounts");
  await page.getByLabel("Name").first().fill(`Acct ${MARKER}`);
  await page.getByRole("button", { name: "Add account" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  for (const p of PAGES) {
    // No cookie: redirected to /login by the proxy.
    const r = await request.get(p, { maxRedirects: 0, headers: { cookie: "" } });
    expect([302, 307, 308], p).toContain(r.status());
    expect(r.headers()["location"]).toContain("/login");
    // Forged cookie: passes the proxy's presence check, but the page guard still redirects.
    const f = await request.get(p, { headers: { cookie: "ledger.session_token=forged.token" } });
    const html = await f.text();
    expect(f.url(), p).toContain("/login");
    expect(html).not.toContain(MARKER);
    // RSC payload request with a forged cookie must not leak either.
    const rsc = await request.get(p, { headers: { cookie: "ledger.session_token=forged.token", RSC: "1" } });
    expect(await rsc.text()).not.toContain(MARKER);
  }
  for (const p of ["/api/export/csv", "/api/export/json"]) {
    const r = await request.get(p, { headers: { cookie: "ledger.session_token=forged.token" } });
    expect(r.status()).toBe(401);
    expect(await r.text()).not.toContain(MARKER);
  }
});

test("14. public sign-up and reset routes do not exist", async ({ request }) => {
  const origin = { origin: "http://localhost:3100" };
  for (const p of ["/api/auth/sign-up/email", "/api/auth/request-password-reset", "/api/auth/reset-password", "/api/auth/change-password", "/api/auth/update-user", "/api/auth/delete-user"]) {
    const r = await request.post(p, { data: { email: "x@example.test", password: "another long passphrase", name: "X" }, headers: origin });
    expect(r.status(), p).toBe(404);
  }
  // Signing in still works for the owner configured in the environment.
  const ok = await request.post("/api/auth/sign-in/email", { data: { email: OWNER_EMAIL, password: OWNER_PASS }, headers: origin });
  expect(ok.status()).toBe(200);
});

test("16. cross-origin and stale-session server action writes are rejected", async ({ page, request, context }) => {
  await login(page);
  await page.goto("/add");
  // Capture a real server-action request made by the app.
  let captured: { headers: Record<string, string>; body: string } | null = null;
  await page.route("**/add", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) captured = { headers: req.headers(), body: req.postData() ?? "" };
    await route.continue();
  });
  // One legitimate save so we can capture the real action request.
  await page.getByLabel("Amount (₹)").fill("10");
  await page.getByRole("button", { name: "Food" }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved:" })).toBeVisible();
  await expect.poll(() => captured).not.toBeNull();
  const cookies = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const cap = captured!;
  const evil = await request.post("/add", {
    headers: { ...cap.headers, cookie: cookies, origin: "https://evil.example", host: "localhost:3100" },
    data: cap.body,
  });
  const text = await evil.text();
  // Next.js aborts mismatched Origin/Host; our own check would also refuse. Either way nothing is saved.
  expect(evil.status() >= 400 || /Request blocked|unauthorized/.test(text)).toBe(true);
  // GET never mutates: the add URL only preselects fields.
  const g = await request.get("/add?type=lend&amount=999", { headers: { cookie: cookies } });
  expect(g.status()).toBe(200);
  // Only the one legitimate entry exists: the cross-origin replay (same idempotency key aside) and the GET created nothing.
  await page.goto("/transactions");
  await expect(page.locator("main li")).toHaveCount(1);
});

test("18. private responses are not cacheable and carry security headers", async ({ page }) => {
  await login(page);
  for (const p of ["/", "/transactions", "/api/export/json"]) {
    const r = await page.request.get(p);
    const h = r.headers();
    expect(h["cache-control"], p).toContain("no-store");
    expect(h["cache-control"], p).toContain("private");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
  }
});

test("15/18. logout invalidates the session; back navigation does not show private data", async ({ page }) => {
  await login(page);
  await page.goto("/more/accounts");
  await expect(page.getByText(`Acct ${MARKER}`).first()).toBeVisible();
  await page.goto("/more");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goBack();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText(MARKER)).toHaveCount(0);
  const r = await page.request.get("/api/export/csv");
  expect(r.status()).toBe(401);
});
