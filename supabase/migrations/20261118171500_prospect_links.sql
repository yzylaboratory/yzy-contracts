-- A company shares a one-time link so a prospect can submit their own
-- enrollment data before anyone creates a case file. Only the SHA-256 digest
-- of the token is stored; the API never persists or logs the token itself.
-- No financial data is collected here, only minimal identity, contact and
-- address fields, so this stays separate from `clients`/`client_operations`.
CREATE TABLE yzy_contracts.prospect_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT,
  token_hash bytea NOT NULL CHECK (length(token_hash) = 32),
  created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX prospect_links_token_hash_idx ON yzy_contracts.prospect_links (token_hash);
CREATE INDEX prospect_links_company_idx
  ON yzy_contracts.prospect_links (company_id, created_at DESC, id DESC);

CREATE TABLE yzy_contracts.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  identity text NOT NULL CHECK (length(identity) BETWEEN 1 AND 64),
  phone text NOT NULL CHECK (length(phone) BETWEEN 1 AND 80),
  address text NOT NULL CHECK (length(address) BETWEEN 1 AND 1000),
  email text CHECK (length(email) <= 254),
  nationality text CHECK (length(nationality) <= 120),
  marital_status text CHECK (length(marital_status) <= 80),
  -- Named to avoid quoting the reserved word "position"; the API maps it to
  -- the public `position` field, matching clients.profile.position.
  occupation text CHECK (length(occupation) <= 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prospects_company_submitted_idx
  ON yzy_contracts.prospects (company_id, submitted_at DESC, id DESC);

REVOKE ALL ON TABLE yzy_contracts.prospect_links, yzy_contracts.prospects
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE yzy_contracts.prospect_links TO yzy_contracts_app;
-- UPDATE is needed to take the row lock behind `SELECT ... FOR UPDATE` when
-- converting a prospect, even though no prospect column is ever updated.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE yzy_contracts.prospects TO yzy_contracts_app;

ALTER TABLE yzy_contracts.prospect_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE yzy_contracts.prospects ENABLE ROW LEVEL SECURITY;

-- The private API role scopes every query itself (company membership, the
-- hashed token, row locks); these policies only gate the role, like the
-- existing clients/client_operations tables.
CREATE POLICY prospect_links_app_access ON yzy_contracts.prospect_links
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);
CREATE POLICY prospects_app_access ON yzy_contracts.prospects
  FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true);
