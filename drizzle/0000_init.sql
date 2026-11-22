CREATE TYPE "public"."account_kind" AS ENUM('cash', 'bank', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'upi', 'card', 'netbanking', 'wallet', 'other');--> statement-breakpoint
CREATE TYPE "public"."theme_pref" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."txn_type" AS ENUM('expense', 'income', 'transfer', 'lend', 'borrow', 'repayment_received', 'repayment_paid');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"opening_balance_paise" bigint DEFAULT 0 NOT NULL,
	"opening_date" date NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_owner_id_id" UNIQUE("owner_id","id"),
	CONSTRAINT "accounts_name_len" CHECK (char_length("accounts"."name") BETWEEN 1 AND 60),
	CONSTRAINT "accounts_opening_range" CHECK (abs("accounts"."opening_balance_paise") <= 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "app_owner" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"user_id" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_owner_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "app_owner_singleton" CHECK ("app_owner"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "budget_category_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"budget_period_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"limit_paise" bigint NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_category_limits_unique" UNIQUE("owner_id","budget_period_id","category_id"),
	CONSTRAINT "bcl_limit" CHECK ("budget_category_limits"."limit_paise" > 0 AND "budget_category_limits"."limit_paise" <= 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "budget_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"overall_limit_paise" bigint,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_periods_owner_id_id" UNIQUE("owner_id","id"),
	CONSTRAINT "budget_periods_owner_start" UNIQUE("owner_id","period_start"),
	CONSTRAINT "budget_periods_range" CHECK ("budget_periods"."period_end" > "budget_periods"."period_start"),
	CONSTRAINT "budget_periods_limit" CHECK ("budget_periods"."overall_limit_paise" IS NULL OR ("budget_periods"."overall_limit_paise" > 0 AND "budget_periods"."overall_limit_paise" <= 1000000000000))
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_owner_id_id" UNIQUE("owner_id","id"),
	CONSTRAINT "categories_name_len" CHECK (char_length("categories"."name") BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"content_hash" text NOT NULL,
	"row_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_owner_id_id" UNIQUE("owner_id","id"),
	CONSTRAINT "import_batches_owner_hash" UNIQUE("owner_id","content_hash"),
	CONSTRAINT "import_batches_kind" CHECK ("import_batches"."kind" IN ('csv', 'json'))
);
--> statement-breakpoint
CREATE TABLE "login_throttle" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_failure_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "opening_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"old_paise" bigint NOT NULL,
	"new_paise" bigint NOT NULL,
	"old_date" date NOT NULL,
	"new_date" date NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opening_changes_subject_type" CHECK ("opening_changes"."subject_type" IN ('account', 'person'))
);
--> statement-breakpoint
CREATE TABLE "owner_settings" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"cycle_start_day" smallint DEFAULT 1 NOT NULL,
	"theme" "theme_pref" DEFAULT 'system' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_settings_cycle_day" CHECK ("owner_settings"."cycle_start_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"label" text,
	"opening_iou_paise" bigint DEFAULT 0 NOT NULL,
	"opening_date" date NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_owner_id_id" UNIQUE("owner_id","id"),
	CONSTRAINT "people_name_len" CHECK (char_length("people"."name") BETWEEN 1 AND 60),
	CONSTRAINT "people_label_len" CHECK ("people"."label" IS NULL OR char_length("people"."label") BETWEEN 1 AND 40),
	CONSTRAINT "people_opening_range" CHECK (abs("people"."opening_iou_paise") <= 1000000000000)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"type" "txn_type" NOT NULL,
	"amount_paise" bigint NOT NULL,
	"txn_date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"to_account_id" uuid,
	"category_id" uuid,
	"person_id" uuid,
	"note" text,
	"payment_method" "payment_method",
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_owner_idem" UNIQUE("owner_id","idempotency_key"),
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount_paise" > 0 AND "transactions"."amount_paise" <= 1000000000000),
	CONSTRAINT "transactions_note_len" CHECK ("transactions"."note" IS NULL OR char_length("transactions"."note") <= 500),
	CONSTRAINT "transactions_idem_len" CHECK (char_length("transactions"."idempotency_key") BETWEEN 8 AND 200),
	CONSTRAINT "transactions_shape" CHECK ((
        ("transactions"."type" = 'transfer' AND "transactions"."to_account_id" IS NOT NULL AND "transactions"."to_account_id" <> "transactions"."account_id"
          AND "transactions"."category_id" IS NULL AND "transactions"."person_id" IS NULL)
        OR ("transactions"."type" IN ('expense', 'income') AND "transactions"."category_id" IS NOT NULL
          AND "transactions"."to_account_id" IS NULL AND "transactions"."person_id" IS NULL)
        OR ("transactions"."type" IN ('lend', 'borrow', 'repayment_received', 'repayment_paid') AND "transactions"."person_id" IS NOT NULL
          AND "transactions"."to_account_id" IS NULL AND "transactions"."category_id" IS NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_owner" ADD CONSTRAINT "app_owner_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_category_limits" ADD CONSTRAINT "bcl_period_fk" FOREIGN KEY ("owner_id","budget_period_id") REFERENCES "public"."budget_periods"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_category_limits" ADD CONSTRAINT "bcl_category_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_changes" ADD CONSTRAINT "opening_changes_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_settings" ADD CONSTRAINT "owner_settings_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fk" FOREIGN KEY ("owner_id","account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_fk" FOREIGN KEY ("owner_id","to_account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_person_fk" FOREIGN KEY ("owner_id","person_id") REFERENCES "public"."people"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_fk" FOREIGN KEY ("owner_id","import_batch_id") REFERENCES "public"."import_batches"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "accounts_owner_idx" ON "accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_owner_kind_name" ON "categories" USING btree ("owner_id","kind",lower("name"));--> statement-breakpoint
CREATE INDEX "opening_changes_owner_subject" ON "opening_changes" USING btree ("owner_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "people_owner_idx" ON "people" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "transactions_owner_date_created_id" ON "transactions" USING btree ("owner_id","txn_date" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_owner_account" ON "transactions" USING btree ("owner_id","account_id");--> statement-breakpoint
CREATE INDEX "transactions_owner_to_account" ON "transactions" USING btree ("owner_id","to_account_id");--> statement-breakpoint
CREATE INDEX "transactions_owner_person_date" ON "transactions" USING btree ("owner_id","person_id","txn_date");--> statement-breakpoint
CREATE INDEX "transactions_owner_category" ON "transactions" USING btree ("owner_id","category_id");