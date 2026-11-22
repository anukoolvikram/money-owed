-- Cross-row integrity rules that a simple CHECK constraint cannot express.
-- The service layer validates the same rules with friendly messages; these
-- triggers are the last line of defence.

-- 1. An expense must use an expense category, an income an income category.
CREATE OR REPLACE FUNCTION ledger_check_txn_category() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE k category_kind;
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT kind INTO k FROM categories WHERE id = NEW.category_id AND owner_id = NEW.owner_id;
  IF k IS NULL OR k::text <> NEW.type::text THEN
    RAISE EXCEPTION 'category kind does not match transaction type' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER transactions_category_kind
  BEFORE INSERT OR UPDATE OF category_id, type ON transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_check_txn_category();
--> statement-breakpoint

-- 2. A category's kind cannot change once any transaction or budget uses it.
CREATE OR REPLACE FUNCTION ledger_lock_category_kind() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> OLD.kind AND (
    EXISTS (SELECT 1 FROM transactions WHERE category_id = OLD.id)
    OR EXISTS (SELECT 1 FROM budget_category_limits WHERE category_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'category kind is in use' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER categories_kind_lock
  BEFORE UPDATE OF kind ON categories
  FOR EACH ROW EXECUTE FUNCTION ledger_lock_category_kind();
--> statement-breakpoint

-- 3. Budget category limits only apply to expense categories.
CREATE OR REPLACE FUNCTION ledger_check_budget_category() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND owner_id = NEW.owner_id AND kind = 'expense') THEN
    RAISE EXCEPTION 'budget limits need an expense category' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER budget_category_limits_kind
  BEFORE INSERT OR UPDATE OF category_id ON budget_category_limits
  FOR EACH ROW EXECUTE FUNCTION ledger_check_budget_category();
--> statement-breakpoint

-- 4. Owner rows are permanent: user ids cannot be swapped under financial data.
CREATE OR REPLACE FUNCTION ledger_owner_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'owner cannot be reassigned' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER app_owner_immutable
  BEFORE UPDATE OF user_id ON app_owner
  FOR EACH ROW EXECUTE FUNCTION ledger_owner_immutable();
