-- Membership grants access to active companies. Legacy contracts remain private
-- until explicitly created as company contracts. Storage ownership stays intact.
CREATE TABLE yzy_contracts.company_memberships (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  company_id uuid NOT NULL REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX company_memberships_company_idx
  ON yzy_contracts.company_memberships (company_id, user_id);

INSERT INTO yzy_contracts.company_memberships (user_id, company_id)
  SELECT owner_id, id FROM yzy_contracts.companies WHERE archived_at IS NULL;

ALTER TABLE yzy_contracts.contracts ADD COLUMN company_id uuid
  REFERENCES yzy_contracts.companies (id) ON DELETE RESTRICT;
CREATE INDEX contracts_company_idx ON yzy_contracts.contracts (company_id, created_at DESC)
  WHERE company_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE yzy_contracts.access_identities (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  name text CHECK (length(name) <= 200),
  suspended boolean NOT NULL DEFAULT false,
  requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_identities_email_idx ON yzy_contracts.access_identities (email);

CREATE TABLE yzy_contracts.access_invitations (
  email text PRIMARY KEY CHECK (email = lower(email) AND length(email) <= 254),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  company_ids uuid[] NOT NULL CHECK (cardinality(company_ids) BETWEEN 1 AND 100),
  accepted_by uuid REFERENCES auth.users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE yzy_contracts.access_mail (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('request', 'invitation')),
  reference text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_id uuid,
  sent_at timestamptz,
  UNIQUE (kind, reference)
);
CREATE INDEX access_mail_pending_idx
  ON yzy_contracts.access_mail (next_attempt_at, id) WHERE sent_at IS NULL;

-- The runtime role can check a single confirmed identity. It has no access to
-- the shared Auth table or to passwords, tokens or metadata.
CREATE FUNCTION yzy_contracts.confirmed_identity_email(requested_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT lower(u.email) FROM auth.users u
  WHERE u.id = requested_user AND u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL AND u.email IS NOT NULL AND length(u.email) <= 254
$$;
CREATE FUNCTION yzy_contracts.confirmed_identity_id(requested_email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(u.id::text)::uuid END FROM auth.users u
  WHERE lower(u.email) = requested_email AND u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL AND length(requested_email) <= 254
$$;

CREATE FUNCTION yzy_contracts.has_company_membership(actor uuid, target_company uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM yzy_contracts.company_memberships m
    JOIN yzy_contracts.companies c ON c.id = m.company_id
    WHERE m.user_id = actor AND m.company_id = target_company AND c.archived_at IS NULL
  )
$$;

REVOKE ALL ON FUNCTION yzy_contracts.confirmed_identity_email(uuid),
  yzy_contracts.confirmed_identity_id(text), yzy_contracts.has_company_membership(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.confirmed_identity_email(uuid),
  yzy_contracts.confirmed_identity_id(text), yzy_contracts.has_company_membership(uuid, uuid)
  TO yzy_contracts_app;

REVOKE ALL ON yzy_contracts.company_memberships, yzy_contracts.access_identities,
  yzy_contracts.access_invitations, yzy_contracts.access_mail
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON yzy_contracts.company_memberships TO yzy_contracts_app;
GRANT SELECT, INSERT, UPDATE ON yzy_contracts.access_identities,
  yzy_contracts.access_invitations, yzy_contracts.access_mail TO yzy_contracts_app;

DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['company_memberships', 'access_identities', 'access_invitations', 'access_mail'] LOOP
    EXECUTE format('ALTER TABLE yzy_contracts.%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('CREATE POLICY app_access ON yzy_contracts.%I FOR ALL TO yzy_contracts_app USING (true) WITH CHECK (true)', relation);
  END LOOP;
END $$;

INSERT INTO yzy_contracts.access_identities (user_id, email, created_at)
SELECT p.user_id, lower(u.email), p.created_at
FROM yzy_contracts.profiles p JOIN auth.users u ON u.id = p.user_id
WHERE p.account_status = 'active' AND u.email_confirmed_at IS NOT NULL
  AND u.deleted_at IS NULL AND u.email IS NOT NULL AND length(u.email) <= 254;

CREATE FUNCTION yzy_contracts.can_read_contract(actor uuid, creator uuid, scope uuid)
RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN scope IS NULL THEN actor = creator
              ELSE yzy_contracts.has_company_membership(actor, scope) END
$$;
REVOKE ALL ON FUNCTION yzy_contracts.can_read_contract(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts.can_read_contract(uuid, uuid, uuid) TO yzy_contracts_app;
