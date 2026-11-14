ALTER TABLE yzy_contracts.contracts
  ADD COLUMN shared_company_ids uuid[],
  ADD CONSTRAINT contracts_shared_company_ids_check CHECK (
    shared_company_ids IS NULL OR (
      company_id IS NULL AND array_ndims(shared_company_ids) = 1
      AND cardinality(shared_company_ids) BETWEEN 1 AND 100
      AND array_position(shared_company_ids, NULL::uuid) IS NULL
    )
  );

-- Keep the previous overload available while the API rolls forward.
CREATE FUNCTION yzy_contracts.can_read_contract(actor uuid, creator uuid, scope uuid, shared_scopes uuid[])
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN shared_scopes IS NULL THEN yzy_contracts.can_read_contract(actor, creator, scope)
              ELSE EXISTS (
                SELECT 1 FROM yzy_contracts.company_memberships m
                JOIN yzy_contracts.companies c ON c.id = m.company_id
                WHERE m.user_id = actor AND m.company_id = ANY(shared_scopes) AND c.archived_at IS NULL
              ) END
$$;
REVOKE ALL ON FUNCTION yzy_contracts.can_read_contract(uuid, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.can_read_contract(uuid, uuid, uuid, uuid[]) TO yzy_contracts_app;
