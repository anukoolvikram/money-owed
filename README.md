# Personal Ledger

A private, single-owner web app for expenses, income, budgets, account balances and IOUs (money you lent or borrowed), built for an iPhone in India. Amounts are in ₹, with Indian number formatting, and the timezone is Asia/Kolkata.

> **Status:** works locally and is tested against a local Postgres database. It has **not been deployed**. Deploying needs your approval and your own Vercel and Neon accounts (see [Deploy](#8-deploy-only-when-you-decide-to)).

---

## Contents

1. [What it does](#1-what-it-does)
2. [Run it on your computer](#2-run-it-on-your-computer)
3. [Environment variables](#3-environment-variables)
4. [Database: Neon, roles and connections](#4-database-neon-roles-and-connections)
5. [Migrations](#5-migrations)
6. [Owner account](#6-owner-account)
7. [Vercel project setup](#7-vercel-project-setup)
8. [Deploy (only when you decide to)](#8-deploy-only-when-you-decide-to)
9. [Pre-launch checklist](#9-pre-launch-checklist)
10. [Backups, restore, updates and deleting your data](#10-backups-restore-updates-and-deleting-your-data)
11. [Costs](#11-costs)
12. [Security model and limits](#12-security-model-and-limits)
13. [Project structure and data model](#13-project-structure-and-data-model)
14. [Tests](#14-tests)
15. [Not built yet](#15-not-built-yet)

---

## 1. What it does

- **Overview:** spending and earned income for the current budget cycle, remaining budget, account total, "owed to me" and "I owe" (shown separately), a daily spending chart, a category breakdown and recent entries.
- **Fast add:** expense is the default. There is a large amount field, frequent categories, an account, the date (defaults to today) and an optional note and payment method. The other modes are *I earned*, *I moved money*, *I lent*, *I borrowed*, *They repaid me* and *I repaid them*.
- **Entries:** search, filter by type, account, category, person or date, paginate, edit and delete.
- **People and IOUs:** each person has one signed balance and a full dated history with a running total. Entries that cross zero (switch who owes whom) need confirmation.
- **Accounts and categories:** create, edit and archive. Anything with history can't be deleted.
- **Budgets:** one overall limit per cycle plus optional per-category limits. The cycle can start on any day from 1 to 31 (for example your salary day).
- **Data:** CSV export, a full JSON backup, restore into an empty ledger, and CSV import with a dry-run preview.

### How each entry type affects your numbers

| Type | Account | Income / spending | Person's balance |
| --- | --- | --- | --- |
| Expense | money out | spending ↑ | — |
| Income | money in | income ↑ | — |
| Transfer | source ↓, destination ↑ | neither | — |
| Lend | money out | neither | they owe me more |
| Borrow | money in | neither | I owe them more |
| Repayment received | money in | neither | they owe me less |
| Repayment paid | money out | neither | I owe them less |

**Person's net = opening + lent + repayments paid − borrowed − repayments received.** A positive balance means they owe you. A negative balance means you owe them.

---

## 2. Run it on your computer

### What you need

| Tool | Version tested |
| --- | --- |
| Node.js | **24.22.3** (see `.nvmrc`; Vercel no longer supports Node 20) |
| npm | 11 (comes with Node 24) |
| PostgreSQL | 14.x locally (Neon runs 16 or 17; nothing here depends on the version) |

Main packages (exact versions are pinned in `package.json` and `package-lock.json`): Next.js 16.4.6, React 19.3.0, Better Auth 1.7.27 with `@better-auth/drizzle-adapter` 1.7.27, Drizzle ORM 0.45.4, drizzle-kit 0.31.11, pg 8.23.1, @vercel/functions 3.11.3, Zod 4.6.7, Recharts 3.11.0, Tailwind CSS 4.3.3, Vitest 5.1.1 and Playwright 1.65.1.

### Steps

```bash
nvm install 24 && nvm use 24        # or install Node 24 another way
npm ci                              # install exact locked versions

# A private Postgres just for this project (data lives in ./.pgdata, which git ignores)
initdb -D .pgdata -U postgres --auth=trust -E UTF8 --locale=C
pg_ctl -D .pgdata -o "-p 54329 -k /tmp -c listen_addresses=localhost" -l .pgdata/server.log start
psql -h localhost -p 54329 -U postgres -c "create database ledger_dev;" -c "create database ledger_test;"
for db in ledger_dev ledger_test; do
  psql -h localhost -p 54329 -U postgres -d $db -f scripts/sql/local-roles.sql
  psql -h localhost -p 54329 -U postgres -d $db -c "ALTER DATABASE $db OWNER TO ledger_admin; ALTER SCHEMA public OWNER TO ledger_admin; REVOKE CREATE ON SCHEMA public FROM PUBLIC;"
done

cp .env.example .env                # then edit .env (see section 3)

npm run db:migrate                  # creates the tables in DATABASE_URL
npm run dev                         # http://localhost:3000, then sign in with ADMIN_USERNAME / ADMIN_PASSWORD
```

The first sign-in creates your owner account from `ADMIN_USERNAME` and `ADMIN_PASSWORD`. There is no separate setup command.

`.env.test` (git-ignored) points the automated tests at the local `ledger_test` database with fictional credentials:

```text
DATABASE_URL="postgresql://ledger_admin@localhost:54329/ledger_test"
ADMIN_USERNAME="owner"
ADMIN_PASSWORD="fictional e2e passphrase 77"
```

Optional fictional sample data (only works on a local database and refuses anything else): `npm run dev:seed`.

To stop the local database: `pg_ctl -D .pgdata stop`.

---

## 3. Environment variables

You set exactly three. All are **server-only**: none start with `NEXT_PUBLIC_`, and the build check in section 14 confirms that none of them reach the browser.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon connection string (the pooled `-pooler` host is fine), with `sslmode=verify-full` (`require` also works; the app treats it as `verify-full`). Used by the app **and** by `npm run db:migrate`. |
| `ADMIN_USERNAME` | Your sign-in name: letters, digits, `.` `_` `-`, or an email address. |
| `ADMIN_PASSWORD` | Your sign-in password. **At least 15 characters** (up to 128); common passwords are refused. A few unrelated words with spaces works well. |

Everything else is worked out automatically:

- **Cookie-signing secret**: derived from `ADMIN_PASSWORD` (HKDF-SHA256, salted with `DATABASE_URL`). Changing the password therefore also signs out every device.
- **App URL and allowed origins**: on Vercel, from Vercel's automatic system variables (`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_URL`, `VERCEL_BRANCH_URL`); locally, `http://localhost:3000`. Keep *Automatically expose System Environment Variables* switched on in Vercel (it is on by default). If you ever host somewhere other than Vercel, set an optional `APP_URL` to the exact `https://` address.
- **Client IP header** for rate limiting: `x-vercel-forwarded-for` when running on Vercel, none locally.

---

## 4. Database: Neon, roles and connections

1. Create a Neon project in the region closest to you (for example AWS Asia Pacific, Mumbai or Singapore). Use a database such as `ledger`.
2. **Separate test data from real data.** Use the local `ledger_test` database for tests. If you want a cloud preview environment, create a **schema-only** branch or a separate project. Neon branches copy data by default, so a normal branch of production would contain your real records.
3. Copy the connection string from Neon (Dashboard → Connect). The **pooled** host works for both the app and migrations. Put it in `.env` locally and in Vercel as `DATABASE_URL`.
4. **One role does everything.** The app connects as the role in `DATABASE_URL`, which owns the tables. That's simpler, but a bug or compromise in the app could change the schema, not just the data. If you want that extra protection later, create a data-only role for the app and run migrations with the owning role instead.
5. How the app talks to the database: it uses `pg` (node-postgres) with a small pool (max 5) and Drizzle's `node-postgres` adapter. `attachDatabasePool()` from `@vercel/functions` closes idle connections before Vercel suspends an instance, as Neon's Vercel guide recommends for Fluid compute. No HTTP-only driver is used, so interactive transactions work. Neon's pooler runs PgBouncer in transaction mode. That is compatible here because each transaction (including Better Auth's, which runs with `transaction: true`) stays on one connection, and `pg` doesn't use named prepared statements by default.
6. **Row-level security is not enabled.** Every query is filtered by the owner ID, and composite foreign keys (`owner_id, id`) stop one owner's rows from pointing at another's. RLS would be optional extra protection, and it isn't claimed here.

---

## 5. Migrations

Migrations are versioned SQL files in `drizzle/`:

- `0000_init.sql` creates the tables, CHECK constraints and composite foreign keys.
- `0001_integrity_triggers.sql` adds four triggers: category kind must match entry type, category kind is locked once used, budget limits apply only to expense categories, and the owner row is immutable.

```bash
# After changing src/server/db/schema/*.ts
npm run db:generate -- --name describe_change   # writes a new SQL file; review it
# Apply deliberately, from a trusted terminal (reads DATABASE_URL from .env):
npm run db:migrate
```

Migrations **never** run during web requests or Vercel builds. Run `npm run db:migrate` yourself before deploying a version that includes a new migration.

---

## 6. Owner account

There is no sign-up page. Sign-up is switched off on the server (`disableSignUp`) and its route returns 404, and the tests check both.

- **Created on first sign-in.** The first time anyone submits the login form, the server creates the single owner from `ADMIN_USERNAME` and `ADMIN_PASSWORD` (with the default categories), then checks the typed credentials as usual.
- **Changing your login.** Update `ADMIN_USERNAME` and/or `ADMIN_PASSWORD` in Vercel (or `.env` locally) and redeploy (or restart). On the next sign-in the stored login is updated and **every session is signed out**. Your ledger data is untouched.
- **Weak password.** If `ADMIN_PASSWORD` breaks the rules above, sign-in is refused and the login page says why, until you fix it.
- **Forgot the password?** There is no email reset. Look it up in Vercel → Settings → Environment Variables, or set a new one and redeploy.
- **Only one owner.** The `app_owner` table can hold only one row (`CHECK (id = 1)`), and simultaneous first sign-ins are serialised by a transaction-scoped advisory lock, which is safe behind Neon's pooler.
- Every financial action checks **both** a valid database session **and** that the session's user is this owner.

The password lives in an environment variable. Anyone who can read your Vercel project settings, or your local `.env`, can read it. Protect those accounts with MFA.

If you lose access to your **Vercel or Neon accounts themselves**, the app can't help. Use those providers' own account-recovery processes.

---

## 7. Vercel project setup

1. Import the repository into Vercel as a Next.js project. Set **Node.js 24.x** in Project Settings → General.
2. In Settings → Environment Variables, add `DATABASE_URL`, `ADMIN_USERNAME` and `ADMIN_PASSWORD` for **Production only**. Paste them into Vercel's form yourself; don't put them in chat or in the repository.
3. **Previews:** don't give Preview deployments the production `DATABASE_URL`. Leave them unset, so previews can't start the app, or point them at a separate schema-only test database.
4. Vercel Deployment Protection is useful as an extra layer, but it doesn't replace the app's login.

> About the client IP header: Vercel documents `x-vercel-forwarded-for` as identical to `x-forwarded-for`. Its docs say it overwrites `X-Forwarded-For` when a proxy sits in front of Vercel, but they don't say explicitly whether a client sending requests directly can spoof either header. The per-account sign-in throttle (section 12) doesn't depend on IP, so login stays throttled either way.

---

## 8. Deploy (only when you decide to)

Nothing has been deployed yet. When you are ready:

```bash
npm i -g vercel
vercel login
vercel link                 # pick or create the project
npm run db:migrate          # 1) create/update tables in the production database (section 5)
vercel deploy --prod        # 2) deploy        # or push to the production branch if Git integration is on
```

Then open the production URL and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` (this first sign-in creates the owner). Work through the checklist below.

**Rolling back:** Vercel → Deployments → pick an earlier deployment → *Promote to Production*. Database migrations don't roll back automatically. Restore the Neon branch to a point in time, or write a reversing migration.

---

## 9. Pre-launch checklist

- [ ] `curl -X POST https://<app>/api/auth/sign-up/email -H "Origin: https://<app>" -d '{}'` returns **404**.
- [ ] Signed in once with `ADMIN_USERNAME` / `ADMIN_PASSWORD`; More shows your username.
- [ ] Five wrong passwords lead to "Too many sign-in attempts", which clears after a short wait.
- [ ] Logged out, `/`, `/transactions` and `/api/export/json` redirect or return 401.
- [ ] No test or seed data in production (`dev:seed` refuses non-local databases).
- [ ] JSON backup downloaded and **test-restored** into a separate empty test ledger.
- [ ] HTTPS works. Response headers include `Strict-Transport-Security` and `Cache-Control: private, no-store`.
- [ ] MFA enabled on your Vercel, Neon and Git hosting accounts.
- [ ] `.env` is git-ignored and not committed (`git ls-files .env` prints nothing).

---

## 10. Backups, restore, updates and deleting your data

- **Backups:** More → Export → *Download full backup (JSON)*. It contains settings, accounts with opening balances, categories, people, every entry, budgets and opening-balance corrections. It contains **no** passwords, hashes, sessions or owner IDs. The CSV export is a list of entries only, **not** a full backup.
- Downloaded files are **not encrypted**. Keep them somewhere private (for example an encrypted disk or a password-manager attachment) and delete old copies yourself.
- **Restore** works only into an **empty** ledger. It runs as one transaction: everything is restored or nothing is. IDs are re-created under the signed-in owner. Restoring the same file twice is refused.
- **Provider backups:** Neon keeps history for point-in-time restore for a plan-dependent window. Check your plan's limits and don't rely on them as your only backup.
- **Updating dependencies:** run `npm outdated`, update deliberately, run the full test suite (section 14), then deploy.
- **Monitoring:** use Vercel's function logs and Neon's metrics. The app's logs never include amounts, notes, names, tokens or connection strings; errors are logged only as generic labels.
- **Deleting your data:** deleting entries or archiving in the app removes active records. To erase everything, delete the Neon project, which also removes its branches and history once Neon's retention period ends. Then delete the Vercel project. Copies inside providers' own backups follow their retention policies and may outlive your deletion for a while.

---

## 11. Costs

The app is designed to fit free tiers: Vercel Hobby (personal, non-commercial use) and Neon Free. **Check current quotas and terms before relying on them; they change, and nothing here promises "free forever".** Expect:

- A cold start of up to a few seconds when Neon's compute wakes after being idle.
- Limits on storage, compute hours and history retention on the free plans.
- No automatic paid upgrades. Nothing in this project enables a paid add-on, Redis, analytics or AI service.

---

## 12. Security model and limits

**What login protects:** login stops anyone else using the app. It is **not** end-to-end encryption. You (as the account owner), authorised administrators of your Vercel and Neon accounts, and the providers themselves sit inside the trust boundary and can technically read the stored data.

**Controls in place (each one tested):**

- **Sessions:** stored in the database and revocable. The cookie is HttpOnly and SameSite=Lax, and Secure over HTTPS. Sessions last a fixed 7 days with no sliding renewal. The cookie cache is off, so revoking a session or removing the owner takes effect immediately. Logout and *sign out everywhere* are available. Changing `ADMIN_PASSWORD` or `ADMIN_USERNAME` and redeploying signs out every device.
- **Owner guard:** `requireOwner()` runs independently in every page, server action and route handler. The owner ID always comes from the validated session, never from form, URL or JSON input. Every query filters by owner ID, and composite foreign keys block references across owners.
- **Request checks:** origin/CSRF checks are explicitly on (Better Auth skips them under `NODE_ENV=test` by default; that skip is overridden). Next.js also compares the server action Origin with the Host, and a further exact-origin check adds a third layer. No GET request changes data, and no CORS is configured.
- **Sign-in throttling:** Better Auth's database-backed rate limit (10 sign-ins per 5 minutes per IP), plus a per-account throttle keyed on a salted hash of the normalised email. That throttle starts after 5 failures, with a 30-second lock that doubles each time up to 15 minutes, and it is never permanent. The failure message is the same whether or not the email exists.
- **Caching and data hygiene:** private pages and APIs send `Cache-Control: private, no-store`. There is no service worker. No financial data is kept in localStorage; only the last-used account ID and the theme are remembered.
- **Headers:** CSP (no third-party origins, `frame-ancestors 'none'`), HSTS on HTTPS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a Permissions-Policy.
- **No third parties:** no analytics, trackers or AI calls.

**Known trade-offs:**

- The CSP allows `'unsafe-inline'` for scripts because Next.js injects inline bootstrap scripts. Moving to nonces is possible later.
- The password is stored in an environment variable (Vercel encrypts these at rest, but anyone with access to the project settings can read it). The database keeps only a hash of it.
- The cookie-signing secret is derived from the password rather than generated separately, so its strength depends on the password. That's why the 15-character minimum stays.
- The app uses a single database role that owns the tables (no separate least-privilege role).
- Passkeys and TOTP are not implemented (see section 15).

**Money rules:**

- Amounts are stored as integer paise (`bigint`) and parsed from strings without floating point. Up to 2 decimals are allowed, the maximum is ₹1,000 crore per amount, and exponents, NaN, zero and negative values are rejected.
- Dates are calendar `DATE` values in your timezone; audit timestamps are UTC.
- Balances are always calculated from the ledger, never stored. A transfer is one row with two account references, so it can't be half-written or counted twice.
- Edits use a version number, so a stale edit from another tab is rejected with a "reload" message. New entries carry an idempotency key, so double taps and retries create only one entry.
- Future-dated entries are rejected. Planned payments are not posted entries.

---

## 13. Project structure and data model

```text
src/
  app/                    Next.js routes
    (app)/                private pages (each calls requireOwnerPage)
    login/                sign-in page
    api/auth/[...all]     Better Auth handler (only 7 endpoints enabled)
    api/export/{csv,json} private downloads (owner-checked, no-store)
    actions/              server actions → runAction (origin + owner check)
  components/             UI (client components hold no secrets)
  lib/                    pure shared code: money, dates, CSV, entry types
  server/                 server-only: env, db, auth, services (data-access layer)
  proxy.ts                optimistic redirect when no session cookie (not security)
drizzle/                  versioned SQL migrations
scripts/                  migrate, grant, provision/recover owner, dev seed, checks
tests/unit, tests/integration   Vitest
e2e/                      Playwright (iPhone-sized viewport)
```

**Tables:**

- **Auth (Better Auth):** `user`, `session`, `account`, `verification`, `rate_limit`.
- `app_owner`: a singleton, with `disabled_at`.
- `login_throttle`: the per-account sign-in throttle.
- `owner_settings`: timezone, cycle start day (1–31) and theme.
- `accounts`: cash, bank or wallet, with signed opening balance, opening date, archive flag and version.
- `categories`: expense or income, with archive flag.
- `people`: optional label, signed opening IOU, as-of date, archive flag and version.
- `transactions`: one of 7 types, positive `amount_paise`, `txn_date`, `account_id`, `to_account_id` (transfers only), `category_id` (expense/income only), `person_id` (IOUs only), note, payment method, version, idempotency key and import batch.
- `budget_periods` and `budget_category_limits`: per-cycle history.
- `opening_changes`: an audit trail of opening-balance corrections. These are shown in the app and are never counted as activity.
- `import_batches`: a content hash, so the same import isn't applied twice.

---

## 14. Tests

```bash
npm run typecheck
npm run lint
npm run test                 # unit + integration (local ledger_test DB, runtime role)
npm run build && npm run check:bundle   # no secrets/fixtures in client JS
npx playwright install chromium         # once
npm run test:e2e             # builds and serves on :3100 against ledger_test
```

Integration tests use `.env.test` and refuse to run against anything except a local `*_test` database. Screenshots from the end-to-end run are written to `e2e/screenshots/`, which git ignores.

**Not covered by automated tests:**

- Real iPhone Safari: keyboard overlap, Add to Home Screen and safe-area insets. The tests use Chromium with iPhone-sized viewports.
- Vercel's real proxy headers.
- Behaviour against a real Neon database.

---

## 15. Not built yet

These are ideas for later. **None of them exist in the app today.**

- Recurring and planned payments, with idempotent posting.
- Refunds and chargebacks as their own type (today: edit or reduce the original expense instead).
- Optional voice or natural-language entry, always shown for review before saving.
- Passkeys or TOTP as a second factor, including enrolment and recovery flows.
- Optional secure iOS Shortcuts or deep links that only pre-fill the form.
- Credit cards with statement cycles, multiple currencies, investments.
- Loan agreements, interest, write-offs, bill splitting and allocating repayments to specific loans.
