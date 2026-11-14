#!/usr/bin/env bash
# Prepares the local database. Never point this at a shared Supabase.
set -euo pipefail

# The image's init scripts leave supabase_auth_admin without a known password.
# Superuser access is local-only here, through the image's supabase_admin role.
# psql only expands :'pw' in input it reads, not in -c.
psql -h db -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -v pw="${POSTGRES_PASSWORD_FOR_AUTH}" \
  <<< "ALTER ROLE supabase_auth_admin WITH PASSWORD :'pw'"

psql -h db -U postgres -d postgres -v ON_ERROR_STOP=1 -f /local/bootstrap.sql
