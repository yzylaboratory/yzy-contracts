-- Members may remove a global client that never had case files. History rows are
-- removed with the client; expedientes (including soft-deleted rows) still block.
CREATE FUNCTION yzy_contracts.delete_client(target uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  resolved uuid := yzy_contracts.resolve_client_id(target);
BEGIN
  PERFORM 1 FROM yzy_contracts.clients WHERE id = resolved FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM yzy_contracts.client_operations WHERE client_id = resolved) THEN
    RAISE EXCEPTION 'client % has case files', resolved USING ERRCODE = '23503';
  END IF;
  DELETE FROM yzy_contracts.client_case_history WHERE client_id = resolved;
  DELETE FROM yzy_contracts.client_aliases
    WHERE client_id = resolved OR legacy_id = resolved;
  DELETE FROM yzy_contracts.clients WHERE id = resolved;
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION yzy_contracts.delete_client(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.delete_client(uuid) TO yzy_contracts_app;