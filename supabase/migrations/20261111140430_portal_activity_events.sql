CREATE TABLE yzy_contracts.portal_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES yzy_contracts.profiles (user_id) ON DELETE RESTRICT,
  client_event_id uuid CHECK (client_event_id <> '00000000-0000-0000-0000-000000000000'),
  event text NOT NULL,
  screen text NOT NULL CHECK (screen IN (
    'dashboard', 'clients', 'client_record', 'contracts', 'contract_create',
    'contract_edit', 'document_generate', 'generated_documents', 'settings',
    'administration', 'billing', 'preaccess', 'login', 'not_found'
  )),
  result text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (user_id, client_event_id),
  CHECK (
    (client_event_id IS NOT NULL AND result = 'observed' AND (
      event IN ('portal_visit', 'portal_redirect')
      OR (event = 'not_found' AND screen = 'not_found')
      OR (event = 'document_previewed' AND screen = 'document_generate')
    ))
    OR (client_event_id IS NULL AND (
      (event = 'client_created' AND screen = 'clients' AND result IN ('success', 'blocked', 'failed'))
      OR (event IN ('client_updated', 'operation_created', 'operation_updated')
          AND screen = 'client_record' AND result IN ('success', 'blocked', 'failed'))
      OR (event IN ('generation_access', 'document_render', 'document_export')
          AND screen = 'document_generate' AND result IN ('blocked', 'failed'))
    ))
  )
);

CREATE INDEX portal_activity_events_user_time_idx
  ON yzy_contracts.portal_activity_events (user_id, occurred_at DESC, id DESC);

REVOKE ALL ON TABLE yzy_contracts.portal_activity_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE yzy_contracts.portal_activity_events TO yzy_contracts_app;
GRANT INSERT (user_id, client_event_id, event, screen, result)
  ON TABLE yzy_contracts.portal_activity_events TO yzy_contracts_app;

ALTER TABLE yzy_contracts.portal_activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_activity_events_app_select ON yzy_contracts.portal_activity_events
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY portal_activity_events_app_insert ON yzy_contracts.portal_activity_events
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
