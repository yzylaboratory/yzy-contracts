BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM pg_roles WHERE rolname = 'yzy_contracts_dev_app'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) OR pg_has_role('yzy_contracts_dev_app', 'yzy_contracts_app', 'MEMBER')
    OR has_schema_privilege('yzy_contracts_dev_app', 'yzy_contracts', 'USAGE') THEN
    RAISE EXCEPTION 'The DEV role must not have production or elevated database privileges';
  END IF;
END $$;

ALTER ROLE yzy_contracts_dev_app LOGIN PASSWORD :'app_password';
COMMIT;
