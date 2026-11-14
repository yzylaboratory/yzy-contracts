-- YZY Contracts, Phase 1: uploads, contracts, Markdown templates and the
-- PostgreSQL-backed conversion queue.
--
-- Prerequisite: provision the yzy_contracts schema and profiles table.
-- For local development, use supabase/local/bootstrap.sql.
--
-- Rules inherited from that script, which re-validates them when it is re-run:
-- nothing here cascades on delete, nothing touches public or another product
-- schema, and auth.users is only ever referenced with ON DELETE RESTRICT.
--
-- Access model: the portal talks to the Rust API, not to PostgREST. The API
-- connects as yzy_contracts_app and enforces ownership in every query. anon and
-- authenticated get no table privileges. Owner-only SELECT policies stay in
-- place so that a future grant cannot expose another user's rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yzy_contracts_app') THEN
    -- NOLOGIN until an operator sets a password out of band. The migration
    -- never contains a credential.
    CREATE ROLE yzy_contracts_app NOLOGIN NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA yzy_contracts TO yzy_contracts_app;

CREATE OR REPLACE FUNCTION yzy_contracts.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = yzy_contracts, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION yzy_contracts.set_updated_at() FROM PUBLIC, anon, authenticated, service_role;

-- A slot reserved by POST /files/upload-url. The object key is server-generated.
CREATE TABLE yzy_contracts.file_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  object_key text NOT NULL UNIQUE,
  original_file_name text NOT NULL CHECK (char_length(original_file_name) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  declared_size_bytes bigint NOT NULL CHECK (declared_size_bytes > 0),
  register_before timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);

-- Serves the worker's sweep of slots that were never registered as contracts.
CREATE INDEX file_uploads_unconsumed_idx
  ON yzy_contracts.file_uploads (register_before)
  WHERE consumed_at IS NULL;

CREATE TABLE yzy_contracts.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  upload_id uuid NOT NULL UNIQUE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description text CHECK (char_length(description) <= 2000),
  original_file_name text NOT NULL CHECK (char_length(original_file_name) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  object_key text NOT NULL UNIQUE,
  -- ETag seen at registration. The worker refuses to convert if the object changed.
  object_etag text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN (
    'uploaded', 'converting', 'converted', 'conversion_failed'
  )),
  -- Set by DELETE. The row is invisible to the API and survives only until the
  -- worker has removed the R2 object, then it is hard-deleted.
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  FOREIGN KEY (upload_id, owner_id)
    REFERENCES yzy_contracts.file_uploads (id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX contracts_owner_created_idx
  ON yzy_contracts.contracts (owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX contracts_owner_status_idx
  ON yzy_contracts.contracts (owner_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX contracts_pending_purge_idx
  ON yzy_contracts.contracts (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE TRIGGER contracts_set_updated_at
  BEFORE UPDATE ON yzy_contracts.contracts
  FOR EACH ROW EXECUTE FUNCTION yzy_contracts.set_updated_at();

-- One template per contract in Phase 1. The composite key guarantees that a
-- template can never belong to a different user than its contract.
CREATE TABLE yzy_contracts.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  content_markdown text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contract_id, owner_id)
    REFERENCES yzy_contracts.contracts (id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX templates_owner_idx ON yzy_contracts.templates (owner_id);

CREATE TRIGGER templates_set_updated_at
  BEFORE UPDATE ON yzy_contracts.templates
  FOR EACH ROW EXECUTE FUNCTION yzy_contracts.set_updated_at();

CREATE TABLE yzy_contracts.conversion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed'
  )),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts >= 1),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- Lease. A crashed worker's job becomes claimable again once locked_until passes.
  locked_by text,
  locked_until timestamptz,
  error_code text,
  error_message text,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  page_count integer CHECK (page_count >= 0),
  template_id uuid REFERENCES yzy_contracts.templates (id) ON DELETE RESTRICT,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contract_id, owner_id)
    REFERENCES yzy_contracts.contracts (id, owner_id) ON DELETE RESTRICT,
  CONSTRAINT conversion_jobs_lease_state CHECK (
    (status = 'processing' AND locked_by IS NOT NULL AND locked_until IS NOT NULL)
    OR (status <> 'processing' AND locked_by IS NULL AND locked_until IS NULL)
  ),
  CONSTRAINT conversion_jobs_completed_state CHECK (
    (status = 'completed' AND template_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND template_id IS NULL)
  ),
  CONSTRAINT conversion_jobs_failed_state CHECK (
    (status = 'failed' AND error_code IS NOT NULL AND completed_at IS NOT NULL)
    OR status <> 'failed'
  )
);

-- Database-level guard against duplicate conversions of one contract.
CREATE UNIQUE INDEX conversion_jobs_one_active_per_contract
  ON yzy_contracts.conversion_jobs (contract_id)
  WHERE status IN ('pending', 'processing');

CREATE INDEX conversion_jobs_contract_created_idx
  ON yzy_contracts.conversion_jobs (contract_id, created_at DESC);

CREATE INDEX conversion_jobs_owner_idx ON yzy_contracts.conversion_jobs (owner_id);

CREATE INDEX conversion_jobs_claim_pending_idx
  ON yzy_contracts.conversion_jobs (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX conversion_jobs_claim_expired_idx
  ON yzy_contracts.conversion_jobs (locked_until)
  WHERE status = 'processing';

CREATE TRIGGER conversion_jobs_set_updated_at
  BEFORE UPDATE ON yzy_contracts.conversion_jobs
  FOR EACH ROW EXECUTE FUNCTION yzy_contracts.set_updated_at();

REVOKE ALL ON TABLE
  yzy_contracts.file_uploads,
  yzy_contracts.contracts,
  yzy_contracts.templates,
  yzy_contracts.conversion_jobs,
  yzy_contracts._sqlx_migrations
FROM PUBLIC, anon, authenticated;

-- The migration ledger lives in a schema PostgREST exposes. No policies: deny all.
ALTER TABLE yzy_contracts._sqlx_migrations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  yzy_contracts.file_uploads,
  yzy_contracts.contracts,
  yzy_contracts.templates,
  yzy_contracts.conversion_jobs
TO yzy_contracts_app;

GRANT SELECT, INSERT ON TABLE yzy_contracts.profiles TO yzy_contracts_app;

ALTER TABLE yzy_contracts.file_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE yzy_contracts.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE yzy_contracts.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE yzy_contracts.conversion_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY file_uploads_select_own ON yzy_contracts.file_uploads
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY contracts_select_own ON yzy_contracts.contracts
  FOR SELECT TO authenticated USING (owner_id = auth.uid() AND deleted_at IS NULL);
CREATE POLICY templates_select_own ON yzy_contracts.templates
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY conversion_jobs_select_own ON yzy_contracts.conversion_jobs
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

-- USING (true) justification: the API role spans every user because the worker
-- has to process any user's job, so row ownership for this role is enforced by
-- the application, in each repository query. No other role receives these policies.
CREATE POLICY file_uploads_app_select ON yzy_contracts.file_uploads
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY file_uploads_app_insert ON yzy_contracts.file_uploads
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
CREATE POLICY file_uploads_app_update ON yzy_contracts.file_uploads
  FOR UPDATE TO yzy_contracts_app USING (true) WITH CHECK (true);
CREATE POLICY file_uploads_app_delete ON yzy_contracts.file_uploads
  FOR DELETE TO yzy_contracts_app USING (true);

CREATE POLICY contracts_app_select ON yzy_contracts.contracts
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY contracts_app_insert ON yzy_contracts.contracts
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
CREATE POLICY contracts_app_update ON yzy_contracts.contracts
  FOR UPDATE TO yzy_contracts_app USING (true) WITH CHECK (true);
CREATE POLICY contracts_app_delete ON yzy_contracts.contracts
  FOR DELETE TO yzy_contracts_app USING (true);

CREATE POLICY templates_app_select ON yzy_contracts.templates
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY templates_app_insert ON yzy_contracts.templates
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
CREATE POLICY templates_app_update ON yzy_contracts.templates
  FOR UPDATE TO yzy_contracts_app USING (true) WITH CHECK (true);
CREATE POLICY templates_app_delete ON yzy_contracts.templates
  FOR DELETE TO yzy_contracts_app USING (true);

CREATE POLICY conversion_jobs_app_select ON yzy_contracts.conversion_jobs
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY conversion_jobs_app_insert ON yzy_contracts.conversion_jobs
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
CREATE POLICY conversion_jobs_app_update ON yzy_contracts.conversion_jobs
  FOR UPDATE TO yzy_contracts_app USING (true) WITH CHECK (true);
CREATE POLICY conversion_jobs_app_delete ON yzy_contracts.conversion_jobs
  FOR DELETE TO yzy_contracts_app USING (true);

CREATE POLICY profiles_app_select ON yzy_contracts.profiles
  FOR SELECT TO yzy_contracts_app USING (true);
-- Enrollment only. Tombstoning stays with delete_account / delete_my_account.
CREATE POLICY profiles_app_enroll ON yzy_contracts.profiles
  FOR INSERT TO yzy_contracts_app
  WITH CHECK (account_status = 'active' AND deleted_at IS NULL);
