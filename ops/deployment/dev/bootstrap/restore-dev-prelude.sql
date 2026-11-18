-- Run with psql --single-transaction immediately before loading the DEV-only dump.
DO $$
DECLARE
  targets text;
BEGIN
  IF to_regnamespace('yzy_contracts') IS NULL
     OR to_regclass('yzy_contracts_dev.client_operations') IS NULL THEN
    RAISE EXCEPTION 'Expected the shared Supabase database with a migrated DEV schema';
  END IF;
  IF EXISTS (SELECT FROM yzy_contracts_dev.companies)
     OR EXISTS (SELECT FROM yzy_contracts_dev.clients)
     OR EXISTS (SELECT FROM yzy_contracts_dev.client_operations) THEN
    RAISE EXCEPTION 'This restore requires a fresh DEV schema';
  END IF;
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
    INTO targets
    FROM pg_tables
    WHERE schemaname = 'yzy_contracts_dev' AND tablename <> '_sqlx_migrations';
  EXECUTE 'TRUNCATE TABLE ' || targets || ' RESTRICT';
END $$;

SET LOCAL session_replication_role = replica;
