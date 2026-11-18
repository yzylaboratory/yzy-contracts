-- Run before the anonymized dump, in the same transaction (psql -1):
--   psql "$DEV_OWNER_URL" -v ON_ERROR_STOP=1 -1 -f load-prelude.sql -f dev-data.sql
-- It refuses to load into a DEV schema that already holds cases, and it clears the
-- singleton rows that the migrations seed, because the dump carries their values.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM yzy_contracts_dev.clients)
     OR EXISTS (SELECT 1 FROM yzy_contracts_dev.companies) THEN
    RAISE EXCEPTION 'yzy_contracts_dev already holds data; refusing to load the anonymized copy';
  END IF;
END
$$;

TRUNCATE TABLE yzy_contracts_dev.billing_pricing, yzy_contracts_dev.billing_bank_destination;
