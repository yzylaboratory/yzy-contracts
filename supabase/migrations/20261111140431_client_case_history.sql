CREATE TABLE yzy_contracts.client_case_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  client_id uuid NOT NULL,
  operation_id uuid,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor_id uuid,
  actor_name text,
  operation_label text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(changes) = 'array'),
  FOREIGN KEY (company_id, client_id) REFERENCES yzy_contracts.clients (company_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (company_id, operation_id) REFERENCES yzy_contracts.client_operations (company_id, id) ON DELETE RESTRICT,
  CHECK (
    (operation_id IS NULL AND kind IN ('client_created', 'client_updated'))
    OR (operation_id IS NOT NULL AND kind IN ('operation_created', 'operation_updated'))
  ),
  CHECK ((actor_id IS NULL) = (actor_name IS NULL)),
  CHECK ((actor_id IS NOT NULL AND kind IN ('client_updated', 'operation_updated')) = (jsonb_array_length(changes) > 0))
);

CREATE INDEX client_case_history_scope_idx
  ON yzy_contracts.client_case_history (company_id, client_id, operation_id, kind, occurred_at DESC);

REVOKE ALL ON TABLE yzy_contracts.client_case_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE yzy_contracts.client_case_history TO yzy_contracts_app;
GRANT INSERT (company_id, client_id, operation_id, kind, occurred_at, actor_id, actor_name, operation_label, changes)
  ON TABLE yzy_contracts.client_case_history TO yzy_contracts_app;

ALTER TABLE yzy_contracts.client_case_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_case_history_app_select ON yzy_contracts.client_case_history
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY client_case_history_app_insert ON yzy_contracts.client_case_history
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
