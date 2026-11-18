-- Isolated DEV database prerequisites for YZY Contracts (yzy_contracts_dev).
-- Never run this against production. Idempotent and safe to re-run.

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', role_name);
    END IF;
  END LOOP;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Stub auth.users only if running on a non-Supabase Postgres image.
-- On supabase/postgres, GoTrue owns auth.* and this block is a no-op.
DO $$
BEGIN
  IF to_regclass('auth.users') IS NULL THEN
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      email_confirmed_at timestamptz,
      deleted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
    CREATE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE
      AS $f$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $f$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS yzy_contracts_dev;
ALTER SCHEMA yzy_contracts_dev OWNER TO postgres;

REVOKE ALL ON SCHEMA yzy_contracts_dev FROM PUBLIC;
GRANT USAGE ON SCHEMA yzy_contracts_dev TO anon, authenticated, service_role, yzy_contracts_dev_app;

CREATE TABLE IF NOT EXISTS yzy_contracts_dev.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'deleted')),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_deleted_state CHECK (
    (account_status = 'active' AND deleted_at IS NULL)
    OR (account_status = 'deleted' AND deleted_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS yzy_contracts_dev.deleted_accounts (
  user_id uuid PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE yzy_contracts_dev.profiles FROM PUBLIC, anon;
REVOKE ALL ON TABLE yzy_contracts_dev.deleted_accounts FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE yzy_contracts_dev.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE yzy_contracts_dev.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE yzy_contracts_dev.deleted_accounts TO service_role;

ALTER TABLE yzy_contracts_dev.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE yzy_contracts_dev.deleted_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select_own ON yzy_contracts_dev.profiles;
CREATE POLICY profiles_select_own
  ON yzy_contracts_dev.profiles
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS profiles_insert_own ON yzy_contracts_dev.profiles;
CREATE POLICY profiles_insert_own
  ON yzy_contracts_dev.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND account_status = 'active'
    AND deleted_at IS NULL
  );

CREATE OR REPLACE FUNCTION yzy_contracts_dev.reject_profile_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = yzy_contracts_dev, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'yzy_contracts_dev.profiles cannot be hard-deleted; use delete_account';
END;
$$;

REVOKE ALL ON FUNCTION yzy_contracts_dev.reject_profile_delete()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS profiles_no_hard_delete ON yzy_contracts_dev.profiles;
CREATE TRIGGER profiles_no_hard_delete
  BEFORE DELETE ON yzy_contracts_dev.profiles
  FOR EACH ROW
  EXECUTE FUNCTION yzy_contracts_dev.reject_profile_delete();

CREATE OR REPLACE FUNCTION yzy_contracts_dev.delete_account(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = yzy_contracts_dev, pg_temp
AS $$
DECLARE
  jwt_role text := auth.role();
  jwt_uid uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required';
  END IF;

  IF jwt_role = 'service_role' THEN
    NULL;
  ELSIF jwt_role IS NULL AND session_user IN ('postgres', 'supabase_admin') THEN
    NULL;
  ELSIF jwt_role = 'authenticated' AND jwt_uid IS NOT NULL AND jwt_uid = p_user_id THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'yzy_contracts_dev.delete_account is limited to the signed-in Contracts user';
  END IF;

  INSERT INTO yzy_contracts_dev.deleted_accounts (user_id, deleted_at)
  VALUES (p_user_id, now())
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE yzy_contracts_dev.profiles
     SET account_status = 'deleted',
         deleted_at = COALESCE(deleted_at, now()),
         updated_at = now()
   WHERE user_id = p_user_id
     AND account_status IS DISTINCT FROM 'deleted';
END;
$$;

CREATE OR REPLACE FUNCTION yzy_contracts_dev.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = yzy_contracts_dev, pg_temp
AS $$
DECLARE
  jwt_uid uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR jwt_uid IS NULL THEN
    RAISE EXCEPTION 'yzy_contracts_dev.delete_my_account requires an authenticated user';
  END IF;

  PERFORM yzy_contracts_dev.delete_account(jwt_uid);
END;
$$;

REVOKE ALL ON FUNCTION yzy_contracts_dev.delete_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION yzy_contracts_dev.delete_my_account() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts_dev.delete_account(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION yzy_contracts_dev.delete_my_account() TO authenticated;
