-- A generated document is an independent snapshot. Contract purge must not
-- remove it or prevent the original account from opening it again.
CREATE TABLE yzy_contracts.generated_documents (
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  id uuid NOT NULL,
  contract_id uuid NOT NULL,
  contract_name text NOT NULL CHECK (char_length(contract_name) BETWEEN 1 AND 200),
  format text NOT NULL CHECK (format IN ('pdf', 'docx', 'email')),
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  markdown text NOT NULL,
  email jsonb,
  imported_from_session boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, id),
  CONSTRAINT generated_documents_email_shape CHECK (
    (format = 'email' AND email IS NOT NULL AND jsonb_typeof(email) = 'object')
    OR (format <> 'email' AND email IS NULL)
  )
);

CREATE INDEX generated_documents_owner_created_idx
  ON yzy_contracts.generated_documents (owner_id, created_at DESC, id DESC);

REVOKE ALL ON TABLE yzy_contracts.generated_documents
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE yzy_contracts.generated_documents TO yzy_contracts_app;

ALTER TABLE yzy_contracts.generated_documents ENABLE ROW LEVEL SECURITY;

-- The private API role serves authenticated accounts. It scopes every
-- statement to the owner derived from the verified bearer token.
CREATE POLICY generated_documents_app_select ON yzy_contracts.generated_documents
  FOR SELECT TO yzy_contracts_app USING (true);
CREATE POLICY generated_documents_app_insert ON yzy_contracts.generated_documents
  FOR INSERT TO yzy_contracts_app WITH CHECK (true);
