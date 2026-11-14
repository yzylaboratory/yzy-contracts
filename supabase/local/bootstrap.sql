-- Local development and test prerequisites. Never run this against a shared
-- Supabase: there, yzy-infra provisions yzy_contracts and GoTrue owns auth.*.
--
-- It is idempotent and works on the supabase/postgres image, where auth.* and
-- the API roles may already exist, and on a blank database, where it stubs them.

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

-- On the supabase/postgres image auth.* already exists and postgres cannot alter it.
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
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  END IF;
END $$;

-- Mirrors the part of yzy-infra's yzy-contracts.sql that the API depends on.
CREATE SCHEMA IF NOT EXISTS yzy_contracts;

REVOKE ALL ON SCHEMA yzy_contracts FROM PUBLIC;
GRANT USAGE ON SCHEMA yzy_contracts TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS yzy_contracts.profiles (
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

REVOKE ALL ON TABLE yzy_contracts.profiles FROM PUBLIC, anon;

ALTER TABLE yzy_contracts.profiles ENABLE ROW LEVEL SECURITY;
