CREATE TABLE yzy_contracts.portal_access_observations (
  user_id uuid PRIMARY KEY REFERENCES yzy_contracts.profiles (user_id) ON DELETE RESTRICT,
  first_portal_access_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_portal_access_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (last_portal_access_at >= first_portal_access_at)
);

CREATE TABLE yzy_contracts.tour_events (
  user_id uuid NOT NULL REFERENCES yzy_contracts.profiles (user_id) ON DELETE RESTRICT,
  run_id uuid NOT NULL CHECK (run_id <> '00000000-0000-0000-0000-000000000000'),
  event text NOT NULL CHECK (event IN ('opened', 'step_viewed', 'completed', 'skipped')),
  step text NOT NULL CHECK (step IN (
    'clients', 'company', 'client', 'client-form', 'operation', 'operation-form',
    'prepare', 'type', 'template', 'continue', 'document-fields', 'preview',
    'export', 'history', 'done'
  )),
  observed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CHECK (event <> 'completed' OR step = 'done'),
  PRIMARY KEY (user_id, run_id, event, step)
);

CREATE UNIQUE INDEX tour_events_one_opened
  ON yzy_contracts.tour_events (user_id, run_id) WHERE event = 'opened';
CREATE UNIQUE INDEX tour_events_one_outcome
  ON yzy_contracts.tour_events (user_id, run_id) WHERE event IN ('completed', 'skipped');
CREATE INDEX tour_events_recent
  ON yzy_contracts.tour_events (user_id, observed_at DESC);
CREATE INDEX tour_events_latest_opened
  ON yzy_contracts.tour_events (user_id, observed_at DESC, run_id DESC) WHERE event = 'opened';
CREATE INDEX access_invitations_accepted_by_idx
  ON yzy_contracts.access_invitations (accepted_by, created_at DESC) WHERE accepted_by IS NOT NULL;

REVOKE ALL ON TABLE yzy_contracts.portal_access_observations, yzy_contracts.tour_events
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE yzy_contracts.portal_access_observations, yzy_contracts.tour_events
  TO yzy_contracts_app;
GRANT UPDATE (last_portal_access_at) ON yzy_contracts.portal_access_observations TO yzy_contracts_app;

ALTER TABLE yzy_contracts.portal_access_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_access_observations_app_select ON yzy_contracts.portal_access_observations
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY portal_access_observations_app_insert ON yzy_contracts.portal_access_observations
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
CREATE POLICY portal_access_observations_app_update ON yzy_contracts.portal_access_observations
  FOR UPDATE TO yzy_contracts_app USING (true) WITH CHECK (true);

ALTER TABLE yzy_contracts.tour_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tour_events_app_select ON yzy_contracts.tour_events
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY tour_events_app_insert ON yzy_contracts.tour_events
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
