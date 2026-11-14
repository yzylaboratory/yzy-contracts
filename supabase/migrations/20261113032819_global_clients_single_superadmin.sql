-- The API authenticates the configured UUID before serving any private route.
-- Pass that same UUID through its private database connections for company checks.
CREATE OR REPLACE FUNCTION yzy_contracts.has_company_membership(actor uuid, target_company uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM yzy_contracts.companies c
    WHERE c.id = target_company AND c.archived_at IS NULL
      AND (
        actor::text = current_setting('yzy_contracts.superadmin_id', true)
        OR EXISTS (
          SELECT 1 FROM yzy_contracts.company_memberships m
          WHERE m.user_id = actor AND m.company_id = c.id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION yzy_contracts.can_read_contract(actor uuid, creator uuid, scope uuid, shared_scopes uuid[])
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN shared_scopes IS NULL THEN yzy_contracts.can_read_contract(actor, creator, scope)
              ELSE EXISTS (
                SELECT 1 FROM unnest(shared_scopes) AS company(id)
                WHERE yzy_contracts.has_company_membership(actor, company.id)
              ) END
$$;

LOCK TABLE yzy_contracts.clients, yzy_contracts.client_operations, yzy_contracts.client_case_history
  IN ACCESS EXCLUSIVE MODE;

ALTER TABLE yzy_contracts.client_case_history
  DROP CONSTRAINT client_case_history_company_id_client_id_fkey,
  ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE yzy_contracts.client_operations
  DROP CONSTRAINT client_operations_company_id_client_id_fkey,
  ADD FOREIGN KEY (company_id) REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT;

-- Preserve records with no identification. A normalized identity match uses
-- the oldest ID for existing links and the latest available value per field.
CREATE TEMP TABLE client_merge ON COMMIT DROP AS
WITH identified AS (
  SELECT id, created_at,
         NULLIF(lower(regexp_replace(identity, '[[:space:]-]+', '', 'g')), '') AS identity_key
  FROM yzy_contracts.clients
)
SELECT id, first_value(id) OVER (PARTITION BY identity_key ORDER BY created_at, id) AS survivor
FROM identified
WHERE identity_key IS NOT NULL;

-- Keep both original records available to the database owner if fields
-- disagree. The directory and the API use only the canonical client.
CREATE TABLE yzy_contracts.client_merge_archive (
  original_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES yzy_contracts.clients (id) ON DELETE RESTRICT,
  original_record jsonb NOT NULL
);
REVOKE ALL ON TABLE yzy_contracts.client_merge_archive
  FROM PUBLIC, anon, authenticated, service_role, yzy_contracts_app;
ALTER TABLE yzy_contracts.client_merge_archive ENABLE ROW LEVEL SECURITY;

INSERT INTO yzy_contracts.client_merge_archive (original_id, client_id, original_record)
SELECT c.id, m.survivor, to_jsonb(c)
FROM client_merge m JOIN yzy_contracts.clients c ON c.id = m.id
WHERE EXISTS (
  SELECT 1 FROM client_merge duplicate
  WHERE duplicate.survivor = m.survivor AND duplicate.id <> duplicate.survivor
);

WITH merged AS (
  SELECT m.survivor,
         (array_agg(c.name ORDER BY c.updated_at DESC, c.id))[1] AS name,
         (array_agg(c.identity ORDER BY c.updated_at DESC, c.id))[1] AS identity,
         (array_agg(c.address ORDER BY c.updated_at DESC, c.id) FILTER (WHERE c.address IS NOT NULL))[1] AS address,
         (array_agg(c.phone ORDER BY c.updated_at DESC, c.id) FILTER (WHERE c.phone IS NOT NULL))[1] AS phone,
         (array_agg(c.email ORDER BY c.updated_at DESC, c.id) FILTER (WHERE c.email IS NOT NULL))[1] AS email,
         (array_agg(c.income_source ORDER BY c.updated_at DESC, c.id) FILTER (WHERE c.income_source IS NOT NULL))[1] AS income_source,
         max(c.updated_at) AS updated_at
  FROM client_merge m JOIN yzy_contracts.clients c ON c.id = m.id
  GROUP BY m.survivor HAVING count(*) > 1
)
UPDATE yzy_contracts.clients c
SET name = m.name, identity = m.identity, address = m.address, phone = m.phone,
    email = m.email, income_source = m.income_source, updated_at = m.updated_at
FROM merged m WHERE c.id = m.survivor;

UPDATE yzy_contracts.client_operations o SET client_id = m.survivor
FROM client_merge m WHERE o.client_id = m.id AND m.id <> m.survivor;

UPDATE yzy_contracts.client_case_history h SET client_id = m.survivor
FROM client_merge m WHERE h.client_id = m.id AND m.id <> m.survivor;

UPDATE yzy_contracts.client_case_history SET company_id = NULL WHERE operation_id IS NULL;
CREATE TABLE yzy_contracts.client_aliases (
  legacy_id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES yzy_contracts.clients (id) ON DELETE RESTRICT,
  CHECK (legacy_id <> client_id)
);
INSERT INTO yzy_contracts.client_aliases (legacy_id, client_id)
SELECT id, survivor FROM client_merge WHERE id <> survivor;
REVOKE ALL ON TABLE yzy_contracts.client_aliases FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE yzy_contracts.client_aliases TO yzy_contracts_app;
ALTER TABLE yzy_contracts.client_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_aliases_app_read ON yzy_contracts.client_aliases
  FOR SELECT TO yzy_contracts_app USING (true);

DELETE FROM yzy_contracts.clients c USING client_merge m WHERE c.id = m.id AND m.id <> m.survivor;

ALTER TABLE yzy_contracts.clients DROP COLUMN company_id;
CREATE INDEX clients_name_idx ON yzy_contracts.clients (lower(name), id);
CREATE UNIQUE INDEX clients_global_identity_idx ON yzy_contracts.clients
  ((NULLIF(lower(regexp_replace(identity, '[[:space:]-]+', '', 'g')), '')));

ALTER TABLE yzy_contracts.client_operations
  ADD FOREIGN KEY (client_id) REFERENCES yzy_contracts.clients (id) ON DELETE RESTRICT;
CREATE INDEX client_operations_global_client_idx
  ON yzy_contracts.client_operations (client_id, created_at DESC, id DESC);

ALTER TABLE yzy_contracts.client_case_history
  ADD FOREIGN KEY (client_id) REFERENCES yzy_contracts.clients (id) ON DELETE RESTRICT,
  ADD CHECK ((company_id IS NULL) = (operation_id IS NULL));
CREATE INDEX client_case_history_global_client_idx
  ON yzy_contracts.client_case_history (client_id, operation_id, kind, occurred_at DESC);

CREATE FUNCTION yzy_contracts.resolve_client_id(requested uuid)
RETURNS uuid LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT client_id FROM yzy_contracts.client_aliases WHERE legacy_id = requested),
    requested
  )
$$;
REVOKE ALL ON FUNCTION yzy_contracts.resolve_client_id(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.resolve_client_id(uuid) TO yzy_contracts_app;

-- Document URLs now span company history from multiple authors. Preserve
-- the administrator's existing URL if two old accounts used the same ID.
WITH ranked AS (
  SELECT owner_id, id, row_number() OVER (
    PARTITION BY id
    ORDER BY (owner_id = NULLIF(current_setting('yzy_contracts.superadmin_id', true), '')::uuid) DESC NULLS LAST,
             created_at, owner_id
  ) AS position
  FROM yzy_contracts.generated_documents
)
UPDATE yzy_contracts.generated_documents d SET id = gen_random_uuid()
FROM ranked r WHERE d.owner_id = r.owner_id AND d.id = r.id AND r.position > 1;

CREATE UNIQUE INDEX generated_documents_global_id_idx ON yzy_contracts.generated_documents (id);
