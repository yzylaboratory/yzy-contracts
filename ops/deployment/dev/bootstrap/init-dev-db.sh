#!/usr/bin/env bash
# Prepares the isolated DEV Supabase PostgreSQL database for YZY Contracts.
# Idempotent: safe to re-run on every deploy before/after migrations.
set -euo pipefail

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required in db.env}"
: "${DEV_APP_ROLE_PASSWORD:?DEV_APP_ROLE_PASSWORD is required in db.env}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

# supabase/postgres leaves supabase_auth_admin without a known password.
psql -h db -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -v pw="${POSTGRES_PASSWORD}" <<'SQL'
ALTER ROLE supabase_auth_admin WITH PASSWORD :'pw';
SQL

# Ensure the DEV runtime role exists with LOGIN and the configured password.
psql -h db -U postgres -d postgres -v ON_ERROR_STOP=1 -v app_pw="${DEV_APP_ROLE_PASSWORD}" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yzy_contracts_dev_app') THEN
    CREATE ROLE yzy_contracts_dev_app NOLOGIN NOINHERIT;
  END IF;
END $$;
ALTER ROLE yzy_contracts_dev_app LOGIN PASSWORD :'app_pw';
SQL

psql -h db -U postgres -d postgres -v ON_ERROR_STOP=1 -f /bootstrap/bootstrap.sql
