-- Local development only. Creates a schema-owning migration role and a
-- least-privilege runtime role. Production uses passwords set in Neon (see README).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_admin') THEN
    CREATE ROLE ledger_admin LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT;
  END IF;
END $$;
