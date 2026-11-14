CREATE FUNCTION yzy_contracts.billing_companies_for(actor uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT DISTINCT c.id
  FROM yzy_contracts.billing_accounts a
  JOIN yzy_contracts.billing_account_companies ac ON ac.account_id = a.id
  JOIN yzy_contracts.companies c ON c.id = ac.company_id
  WHERE a.manager_user_id = actor AND ac.ends_on IS NULL AND c.archived_at IS NULL
    AND yzy_contracts.has_enabled_access(actor)
$$;
REVOKE ALL ON FUNCTION yzy_contracts.billing_companies_for(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.billing_companies_for(uuid) TO yzy_contracts_app;
