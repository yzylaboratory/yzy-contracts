CREATE TABLE yzy_contracts.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  identity text CHECK (length(identity) <= 64),
  address text CHECK (length(address) <= 1000),
  phone text CHECK (length(phone) <= 80),
  email text CHECK (length(email) <= 254),
  income_source text CHECK (length(income_source) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id)
);

CREATE INDEX clients_company_name_idx
  ON yzy_contracts.clients (company_id, lower(name), id);

CREATE TABLE yzy_contracts.client_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  client_id uuid NOT NULL,
  -- Keep the original reference if an old template is purged.
  contract_id uuid NOT NULL,
  reference text CHECK (length(reference) <= 200),
  contract_date date,
  vehicle jsonb NOT NULL CHECK (jsonb_typeof(vehicle) = 'object'),
  financing jsonb CHECK (jsonb_typeof(financing) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, client_id) REFERENCES yzy_contracts.clients (company_id, id) ON DELETE RESTRICT,
  UNIQUE (company_id, id)
);

CREATE INDEX client_operations_client_created_idx
  ON yzy_contracts.client_operations (company_id, client_id, created_at DESC, id DESC);

ALTER TABLE yzy_contracts.generated_documents
  ADD COLUMN operation_id uuid,
  ADD COLUMN operation_company_id uuid,
  ADD CONSTRAINT generated_documents_operation_fk FOREIGN KEY (operation_company_id, operation_id)
    REFERENCES yzy_contracts.client_operations (company_id, id) MATCH FULL ON DELETE RESTRICT,
  ADD CONSTRAINT generated_documents_operation_scope CHECK (
    operation_id IS NULL OR (
      (company->>'id' = operation_company_id::text) IS TRUE AND artifact IS NOT NULL
    )
  );

CREATE INDEX generated_documents_operation_idx
  ON yzy_contracts.generated_documents (operation_company_id, operation_id)
  WHERE operation_id IS NOT NULL;

REVOKE ALL ON TABLE yzy_contracts.clients, yzy_contracts.client_operations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE yzy_contracts.clients, yzy_contracts.client_operations
  TO yzy_contracts_app;

ALTER TABLE yzy_contracts.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE yzy_contracts.client_operations ENABLE ROW LEVEL SECURITY;

-- The private API role scopes each query to the verified user and company.
CREATE POLICY clients_app_access ON yzy_contracts.clients
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);
CREATE POLICY client_operations_app_access ON yzy_contracts.client_operations
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);

CREATE FUNCTION yzy_contracts.can_use_client_contract(actor uuid, target_contract uuid, target_company uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT yzy_contracts.has_company_membership(actor, target_company)
    AND EXISTS (
      SELECT 1 FROM yzy_contracts.contracts c
      WHERE c.id = target_contract AND c.deleted_at IS NULL
        AND (c.company_id = target_company OR target_company = ANY(c.shared_company_ids))
    )
$$;

REVOKE ALL ON FUNCTION yzy_contracts.can_use_client_contract(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.can_use_client_contract(uuid, uuid, uuid)
  TO yzy_contracts_app;
