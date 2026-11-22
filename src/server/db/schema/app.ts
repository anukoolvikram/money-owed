import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Largest single amount / opening balance magnitude: ₹1,000 crore = 10^12 paise.
// Kept in SQL as a literal so CHECK constraints match src/lib/money.ts.
const MAX_PAISE = sql.raw("1000000000000");

export const txnType = pgEnum("txn_type", [
  "expense",
  "income",
  "transfer",
  "lend",
  "borrow",
  "repayment_received",
  "repayment_paid",
]);
export const accountKind = pgEnum("account_kind", ["cash", "bank", "wallet"]);
export const categoryKind = pgEnum("category_kind", ["expense", "income"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "upi", "card", "netbanking", "wallet", "other"]);
export const themePref = pgEnum("theme_pref", ["system", "light", "dark"]);

// Millisecond precision so timestamps round-trip exactly through JS Dates
// (keyset pagination cursors depend on this).
const audit = {
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
};

/**
 * Singleton owner. The primary key is fixed to 1 by a CHECK, so a second row is
 * impossible regardless of application code or racing provisioning commands.
 */
export const appOwner = pgTable(
  "app_owner",
  {
    id: smallint("id").primaryKey().default(1),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("app_owner_singleton", sql`${t.id} = 1`)],
);

/** Per-account sign-in throttle keyed by a hash of the normalised email. */
export const loginThrottle = pgTable("login_throttle", {
  keyHash: text("key_hash").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
});

export const ownerSettings = pgTable(
  "owner_settings",
  {
    ownerId: text("owner_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "restrict" }),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    cycleStartDay: smallint("cycle_start_day").notNull().default(1),
    theme: themePref("theme").notNull().default("system"),
    ...audit,
  },
  (t) => [check("owner_settings_cycle_day", sql`${t.cycleStartDay} BETWEEN 1 AND 31`)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    kind: accountKind("kind").notNull(),
    openingBalancePaise: bigint("opening_balance_paise", { mode: "bigint" }).notNull().default(sql`0`),
    openingDate: date("opening_date", { mode: "string" }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...audit,
  },
  (t) => [
    unique("accounts_owner_id_id").on(t.ownerId, t.id),
    index("accounts_owner_idx").on(t.ownerId),
    check("accounts_name_len", sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check("accounts_opening_range", sql`abs(${t.openingBalancePaise}) <= ${MAX_PAISE}`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...audit,
  },
  (t) => [
    unique("categories_owner_id_id").on(t.ownerId, t.id),
    uniqueIndex("categories_owner_kind_name").on(t.ownerId, t.kind, sql`lower(${t.name})`),
    check("categories_name_len", sql`char_length(${t.name}) BETWEEN 1 AND 40`),
  ],
);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Optional distinguishing label, e.g. "college" — names need not be unique. */
    label: text("label"),
    /** Signed: positive = they owed me at the opening date; negative = I owed them. */
    openingIouPaise: bigint("opening_iou_paise", { mode: "bigint" }).notNull().default(sql`0`),
    openingDate: date("opening_date", { mode: "string" }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    ...audit,
  },
  (t) => [
    unique("people_owner_id_id").on(t.ownerId, t.id),
    index("people_owner_idx").on(t.ownerId),
    check("people_name_len", sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check("people_label_len", sql`${t.label} IS NULL OR char_length(${t.label}) BETWEEN 1 AND 40`),
    check("people_opening_range", sql`abs(${t.openingIouPaise}) <= ${MAX_PAISE}`),
  ],
);

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    contentHash: text("content_hash").notNull(),
    rowCount: integer("row_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("import_batches_owner_id_id").on(t.ownerId, t.id),
    unique("import_batches_owner_hash").on(t.ownerId, t.contentHash),
    check("import_batches_kind", sql`${t.kind} IN ('csv', 'json')`),
  ],
);

/**
 * One row per logical entry. A transfer is ONE row with account_id (source) and
 * to_account_id (destination), so it can never be half-written or counted twice.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    type: txnType("type").notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    txnDate: date("txn_date", { mode: "string" }).notNull(),
    accountId: uuid("account_id").notNull(),
    toAccountId: uuid("to_account_id"),
    categoryId: uuid("category_id"),
    personId: uuid("person_id"),
    note: text("note"),
    paymentMethod: paymentMethod("payment_method"),
    version: integer("version").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    importBatchId: uuid("import_batch_id"),
    ...audit,
  },
  (t) => [
    unique("transactions_owner_idem").on(t.ownerId, t.idempotencyKey),
    index("transactions_owner_date_created_id").on(t.ownerId, t.txnDate.desc(), t.createdAt.desc(), t.id.desc()),
    index("transactions_owner_account").on(t.ownerId, t.accountId),
    index("transactions_owner_to_account").on(t.ownerId, t.toAccountId),
    index("transactions_owner_person_date").on(t.ownerId, t.personId, t.txnDate),
    index("transactions_owner_category").on(t.ownerId, t.categoryId),
    // Composite FKs: a referenced account/category/person must belong to the same owner.
    foreignKey({ name: "transactions_account_fk", columns: [t.ownerId, t.accountId], foreignColumns: [accounts.ownerId, accounts.id] }).onDelete("restrict"),
    foreignKey({ name: "transactions_to_account_fk", columns: [t.ownerId, t.toAccountId], foreignColumns: [accounts.ownerId, accounts.id] }).onDelete("restrict"),
    foreignKey({ name: "transactions_category_fk", columns: [t.ownerId, t.categoryId], foreignColumns: [categories.ownerId, categories.id] }).onDelete("restrict"),
    foreignKey({ name: "transactions_person_fk", columns: [t.ownerId, t.personId], foreignColumns: [people.ownerId, people.id] }).onDelete("restrict"),
    foreignKey({ name: "transactions_import_fk", columns: [t.ownerId, t.importBatchId], foreignColumns: [importBatches.ownerId, importBatches.id] }).onDelete("restrict"),
    check("transactions_amount_positive", sql`${t.amountPaise} > 0 AND ${t.amountPaise} <= ${MAX_PAISE}`),
    check("transactions_note_len", sql`${t.note} IS NULL OR char_length(${t.note}) <= 500`),
    check("transactions_idem_len", sql`char_length(${t.idempotencyKey}) BETWEEN 8 AND 200`),
    check(
      "transactions_shape",
      sql`(
        (${t.type} = 'transfer' AND ${t.toAccountId} IS NOT NULL AND ${t.toAccountId} <> ${t.accountId}
          AND ${t.categoryId} IS NULL AND ${t.personId} IS NULL)
        OR (${t.type} IN ('expense', 'income') AND ${t.categoryId} IS NOT NULL
          AND ${t.toAccountId} IS NULL AND ${t.personId} IS NULL)
        OR (${t.type} IN ('lend', 'borrow', 'repayment_received', 'repayment_paid') AND ${t.personId} IS NOT NULL
          AND ${t.toAccountId} IS NULL AND ${t.categoryId} IS NULL)
      )`,
    ),
  ],
);

/** A budget belongs to one concrete cycle [periodStart, periodEnd). History is never rewritten. */
export const budgetPeriods = pgTable(
  "budget_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    overallLimitPaise: bigint("overall_limit_paise", { mode: "bigint" }),
    ...audit,
  },
  (t) => [
    unique("budget_periods_owner_id_id").on(t.ownerId, t.id),
    unique("budget_periods_owner_start").on(t.ownerId, t.periodStart),
    check("budget_periods_range", sql`${t.periodEnd} > ${t.periodStart}`),
    check(
      "budget_periods_limit",
      sql`${t.overallLimitPaise} IS NULL OR (${t.overallLimitPaise} > 0 AND ${t.overallLimitPaise} <= ${MAX_PAISE})`,
    ),
  ],
);

export const budgetCategoryLimits = pgTable(
  "budget_category_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").notNull(),
    budgetPeriodId: uuid("budget_period_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    limitPaise: bigint("limit_paise", { mode: "bigint" }).notNull(),
    ...audit,
  },
  (t) => [
    unique("budget_category_limits_unique").on(t.ownerId, t.budgetPeriodId, t.categoryId),
    foreignKey({ name: "bcl_period_fk", columns: [t.ownerId, t.budgetPeriodId], foreignColumns: [budgetPeriods.ownerId, budgetPeriods.id] }).onDelete("cascade"),
    foreignKey({ name: "bcl_category_fk", columns: [t.ownerId, t.categoryId], foreignColumns: [categories.ownerId, categories.id] }).onDelete("restrict"),
    check("bcl_limit", sql`${t.limitPaise} > 0 AND ${t.limitPaise} <= ${MAX_PAISE}`),
  ],
);

/**
 * Audit trail of deliberate opening-balance / opening-IOU corrections. These are
 * NOT transactions and never count as income, spending or IOU activity.
 */
export const openingChanges = pgTable(
  "opening_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    oldPaise: bigint("old_paise", { mode: "bigint" }).notNull(),
    newPaise: bigint("new_paise", { mode: "bigint" }).notNull(),
    oldDate: date("old_date", { mode: "string" }).notNull(),
    newDate: date("new_date", { mode: "string" }).notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("opening_changes_owner_subject").on(t.ownerId, t.subjectType, t.subjectId),
    check("opening_changes_subject_type", sql`${t.subjectType} IN ('account', 'person')`),
  ],
);
