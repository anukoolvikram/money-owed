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
6. [Owner account: create and recover](#6-owner-account-create-and-recover)
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

cp .env.example .env.local          # then edit .env.local (see section 3)
cp .env.example .env.test           # point this one at ledger_test on port 3100

npm run db:migrate                  # creates the tables (uses MIGRATION_DATABASE_URL)
npm run db:grant -- ledger_app      # gives the runtime role data-only access
npm run owner:provision             # asks for email + hidden passphrase
npm run dev                         # http://localhost:3000
```

Optional fictional sample data (only works on a local database and refuses anything else): `npm run dev:seed`.

To stop the local database: `pg_ctl -D .pgdata stop`.

For local `.env.local` you can use trust authentication on localhost:

```text
DATABASE_URL="postgresql://ledger_app@localhost:54329/ledger_dev"
MIGRATION_DATABASE_URL="postgresql://ledger_admin@localhost:54329/ledger_dev"
BETTER_AUTH_URL="http://localhost:3000"
```

Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32` and paste it into the file yourself. Don't paste it into chats or issue trackers.

---

## 3. Environment variables

All of these are **server-only**. None start with `NEXT_PUBLIC_`, and the build check in section 14 confirms that none of them reach the browser.

| Name | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | app (Vercel + local) | Runtime connection: the **least-privilege role** on Neon's **pooled** endpoint, with TLS. |
| `MIGRATION_DATABASE_URL` | your terminal only | Schema-owning role on Neon's **direct** endpoint. Used by migrate, grant, provision and recover. **Never add it to Vercel.** |
| `BETTER_AUTH_SECRET` | app | At least 32 random characters. Signs auth cookies. Different for each environment. |
| `BETTER_AUTH_URL` | app + terminal | The exact public origin, e.g. `https://ledger.example.com`. It must be `https://` in production. Secure cookies and HSTS switch on when it is. |
| `TRUSTED_ORIGINS` | app (optional) | Extra **exact** origins, separated by commas. Wildcards are rejected. |
| `AUTH_CLIENT_IP_HEADER` | app | The header that holds the real client IP. On Vercel use `x-vercel-forwarded-for`. Leave it empty locally. |

The owner's passphrase is **never** an environment variable. It is typed into a hidden terminal prompt.

---

## 4. Database: Neon, roles and connections

1. Create a Neon project in the region closest to you (for example AWS Asia Pacific, Mumbai or Singapore). Use a database such as `ledger`.
2. **Separate test data from real data.** Use the local `ledger_test` database for tests. If you want a cloud preview environment, create a **schema-only** branch or a separate project. Neon branches copy data by default, so a normal branch of production would contain your real records.
3. **Create two roles** (Neon console → Roles, or SQL as the project owner):

   ```sql
   -- Owns the schema; used only from your terminal for migrations and admin commands.
   CREATE ROLE ledger_admin WITH LOGIN PASSWORD '<set in Neon console or a password manager>';
   GRANT ALL ON SCHEMA public TO ledger_admin;   -- or ALTER SCHEMA public OWNER TO ledger_admin
   -- Used by the running app: data access only, no DDL, no superuser.
   CREATE ROLE ledger_app WITH LOGIN PASSWORD '<different strong password>';
   ```

   Creating the roles in the Neon console is easier, because it generates passwords you can copy straight into your files without typing them anywhere else.
4. Connection strings:
   - **Runtime (`DATABASE_URL`)**: the **pooled** host (its name contains `-pooler`), user `ledger_app`, and `?sslmode=verify-full`.
   - **Migration (`MIGRATION_DATABASE_URL`)**: the **direct** host (no `-pooler`), user `ledger_admin`, and `?sslmode=verify-full`. The provisioning command uses a session-level advisory lock, which needs a direct connection.
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
# Apply deliberately, from a trusted terminal, once per environment:
LEDGER_ENV_FILE=.env.production.local npm run db:migrate
LEDGER_ENV_FILE=.env.production.local npm run db:grant -- ledger_app
```

Migrations **never** run during web requests or Vercel builds. Re-run `db:grant` after any migration that adds tables.

---

## 6. Owner account: create and recover

There is no sign-up page. Sign-up is switched off on the server (`disableSignUp`) and its route returns 404, and the tests check both.

**Create the single owner** (once):

```bash
LEDGER_ENV_FILE=.env.production.local npm run owner:provision
# Owner email: you@example.com
# Passphrase: (hidden)    Repeat passphrase: (hidden)
```

- The passphrase needs at least 15 characters and can be up to 128. Spaces and pasting are fine. Common passwords are rejected using the maintained `@zxcvbn-ts/language-common` list, along with simple repetitions and padded variants of them.
- A second owner is impossible. The `app_owner` table can hold only one row (`CHECK (id = 1)`), and parallel runs are serialised by an advisory lock. The command never overwrites an existing account.
- Every financial action checks **both** a valid database session **and** that the session's user is this owner. Any other account that ends up in the auth tables gets no access.

**Forgot the passphrase?** There is no email reset. Someone with database access runs:

```bash
LEDGER_ENV_FILE=.env.production.local npm run owner:recover
```

It asks for the existing owner's email and a new hidden passphrase, then **signs out every session**. It needs `MIGRATION_DATABASE_URL`, so it can't be reached from the web.

If you lose access to your **Vercel or Neon accounts themselves**, the app can't help. Use those providers' own account-recovery processes.

---

## 7. Vercel project setup

1. Import the repository into Vercel as a Next.js project. Set **Node.js 24.x** in Project Settings → General.
2. In Settings → Environment Variables, add these for **Production only**: `DATABASE_URL` (runtime role, pooled), `BETTER_AUTH_SECRET` (new, production-only), `BETTER_AUTH_URL` (your exact production URL), and `AUTH_CLIENT_IP_HEADER=x-vercel-forwarded-for`. Do **not** add `MIGRATION_DATABASE_URL`.
3. **Previews:** don't give Preview deployments the production `DATABASE_URL` or secret. Either leave them unset, so previews can't start the app, or point them at a schema-only test database with its own secret and its own exact `BETTER_AUTH_URL`. Don't add wildcard preview domains to `TRUSTED_ORIGINS`.
4. Vercel Deployment Protection is useful as an extra layer, but it doesn't replace the app's login.

> About the client IP header: Vercel documents `x-vercel-forwarded-for` as identical to `x-forwarded-for`. Its docs say it overwrites `X-Forwarded-For` when a proxy sits in front of Vercel, but they don't say explicitly whether a client sending requests directly can spoof either header. The per-account sign-in throttle (section 12) doesn't depend on IP, so login stays throttled either way.

---

## 8. Deploy (only when you decide to)

Nothing has been deployed yet. When you are ready:

```bash
npm i -g vercel
vercel login
vercel link                 # pick or create the project
# 1) apply migrations + grants to the production database (section 5)
# 2) provision the owner (section 6)
vercel deploy --prod        # or push to the production branch if Git integration is on
```

Then open the production URL, sign in and work through the checklist below.

**Rolling back:** Vercel → Deployments → pick an earlier deployment → *Promote to Production*. Database migrations don't roll back automatically. Restore the Neon branch to a point in time, or write a reversing migration.

---

## 9. Pre-launch checklist

- [ ] `curl -X POST https://<app>/api/auth/sign-up/email -H "Origin: https://<app>" -d '{}'` returns **404**.
- [ ] Owner provisioned. Running `npm run owner:provision` a second time is refused.
- [ ] Five wrong passphrases lead to "Too many sign-in attempts", which clears after a short wait.
- [ ] Logged out, `/`, `/transactions` and `/api/export/json` redirect or return 401.
- [ ] No test or seed data in production (`dev:seed` refuses non-local databases).
- [ ] JSON backup downloaded and **test-restored** into a separate empty test ledger.
- [ ] HTTPS works. Response headers include `Strict-Transport-Security` and `Cache-Control: private, no-store`.
- [ ] MFA enabled on your Vercel, Neon and Git hosting accounts.
- [ ] `MIGRATION_DATABASE_URL` stored only on your computer, in a git-ignored file or a password manager.

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

- **Sessions:** stored in the database and revocable. The cookie is HttpOnly and SameSite=Lax, and Secure over HTTPS. Sessions last a fixed 7 days with no sliding renewal. The cookie cache is off, so revoking a session or removing the owner takes effect immediately. Logout, *sign out everywhere*, and password change (which signs out other devices) are all available.
- **Owner guard:** `requireOwner()` runs independently in every page, server action and route handler. The owner ID always comes from the validated session, never from form, URL or JSON input. Every query filters by owner ID, and composite foreign keys block references across owners.
- **Request checks:** origin/CSRF checks are explicitly on (Better Auth skips them under `NODE_ENV=test` by default; that skip is overridden). Next.js also compares the server action Origin with the Host, and a further exact-origin check adds a third layer. No GET request changes data, and no CORS is configured.
- **Sign-in throttling:** Better Auth's database-backed rate limit (10 sign-ins per 5 minutes per IP), plus a per-account throttle keyed on a salted hash of the normalised email. That throttle starts after 5 failures, with a 30-second lock that doubles each time up to 15 minutes, and it is never permanent. The failure message is the same whether or not the email exists.
- **Caching and data hygiene:** private pages and APIs send `Cache-Control: private, no-store`. There is no service worker. No financial data is kept in localStorage; only the last-used account ID and the theme are remembered.
- **Headers:** CSP (no third-party origins, `frame-ancestors 'none'`), HSTS on HTTPS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a Permissions-Policy.
- **No third parties:** no analytics, trackers or AI calls.

**Known trade-offs:**

- The CSP allows `'unsafe-inline'` for scripts because Next.js injects inline bootstrap scripts. Moving to nonces is possible later.
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

Integration tests connect as the least-privilege `ledger_app` role and refuse to run against anything except a local `*_test` database. Screenshots from the end-to-end run are written to `e2e/screenshots/`, which git ignores.

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
