CREATE TABLE yzy_contracts.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  variable_values jsonb NOT NULL CHECK (
    jsonb_typeof(variable_values) = 'object'
    AND variable_values ? 'empresa_razon_social'
    AND jsonb_typeof(variable_values->'empresa_razon_social') = 'string'
    AND NOT (variable_values ? 'empresa_nombre')
  ),
  is_default boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (archived_at IS NULL OR NOT is_default)
);

CREATE INDEX companies_owner_created_idx
  ON yzy_contracts.companies (owner_id, created_at, id);

CREATE UNIQUE INDEX companies_owner_default_idx
  ON yzy_contracts.companies (owner_id)
  WHERE archived_at IS NULL AND is_default;

CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON yzy_contracts.companies
  FOR EACH ROW EXECUTE FUNCTION yzy_contracts.set_updated_at();

REVOKE ALL ON TABLE yzy_contracts.companies
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE yzy_contracts.companies TO yzy_contracts_app;
GRANT UPDATE (name, variable_values, is_default, archived_at)
  ON TABLE yzy_contracts.companies TO yzy_contracts_app;

ALTER TABLE yzy_contracts.companies ENABLE ROW LEVEL SECURITY;

-- The API role serves authenticated accounts and includes the owner derived
-- from the verified bearer token in every company query.
CREATE POLICY companies_app_select ON yzy_contracts.companies
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY companies_app_insert ON yzy_contracts.companies
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
CREATE POLICY companies_app_update ON yzy_contracts.companies
  FOR UPDATE TO yzy_contracts_app USING (true) WITH CHECK (true);

-- The exported document and its company values form one immutable snapshot.
-- A history entry does not depend on the current company profile.
ALTER TABLE yzy_contracts.generated_documents
  ADD COLUMN company jsonb CHECK (
    company IS NULL OR (artifact IS NOT NULL AND jsonb_typeof(company) = 'object')
  );
