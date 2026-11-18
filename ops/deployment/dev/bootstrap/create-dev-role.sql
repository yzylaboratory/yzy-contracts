DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yzy_contracts_dev_app') THEN
    CREATE ROLE yzy_contracts_dev_app NOLOGIN NOINHERIT;
  END IF;
END $$;
