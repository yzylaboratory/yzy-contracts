-- The superadministrator enables or disables each person. An enabled person
-- works in every active company; company assignment no longer grants access.
ALTER TABLE yzy_contracts.access_identities ADD COLUMN enabled_at timestamptz;

-- Keep access for people who could already enter through an assigned company.
UPDATE yzy_contracts.access_identities i SET enabled_at = now()
WHERE NOT i.suspended AND EXISTS (
  SELECT 1 FROM yzy_contracts.company_memberships m
  JOIN yzy_contracts.companies c ON c.id = m.company_id
  WHERE m.user_id = i.user_id AND c.archived_at IS NULL
);

CREATE FUNCTION yzy_contracts.has_enabled_access(actor uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT actor::text = current_setting('yzy_contracts.superadmin_id', true)
    OR EXISTS (
      SELECT 1 FROM yzy_contracts.access_identities i
      JOIN yzy_contracts.profiles p ON p.user_id = i.user_id
      WHERE i.user_id = actor AND i.enabled_at IS NOT NULL AND NOT i.suspended
        AND p.account_status = 'active'
    )
$$;
REVOKE ALL ON FUNCTION yzy_contracts.has_enabled_access(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.has_enabled_access(uuid) TO yzy_contracts_app;

CREATE OR REPLACE FUNCTION yzy_contracts.has_company_membership(actor uuid, target_company uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM yzy_contracts.companies c
    WHERE c.id = target_company AND c.archived_at IS NULL
  ) AND yzy_contracts.has_enabled_access(actor)
$$;
