#!/usr/bin/env bash
# Receives a one-line export created by export-case-shapes.sql.
set -euo pipefail
cd "$(dirname "$0")/.."
owner=$(docker exec yzylabs-supabase-db psql -XqAt -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT id FROM auth.users WHERE email = 'admin@yzylabs.com' AND email_confirmed_at IS NOT NULL")
[[ "$owner" =~ ^[[:xdigit:]]{8}-([[:xdigit:]]{4}-){3}[[:xdigit:]]{12}$ ]]
IFS= read -r payload
if [[ "$payload" != '{'*'}' ]] || IFS= read -r extra; then
  echo "Expected one JSON export row" >&2
  exit 1
fi

{
  printf '%s\n' 'BEGIN;' 'CREATE TEMP TABLE _dev_seed (payload jsonb NOT NULL);'
  printf '%s\n' 'COPY _dev_seed (payload) FROM STDIN;' "$payload" '\.'
  cat scripts/finish-case-import.sql
} | docker exec -i yzylabs-supabase-db psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -v owner="$owner"
