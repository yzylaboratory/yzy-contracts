#!/bin/sh
# Builds the anonymized DEV dump from a production data dump, inside a throwaway
# scratch database. DEV never sees the source data, and the anonymization runs
# before anything leaves the scratch server.
#
#   copy-dev-data.sh <source-data.sql> <dev-owner-uuid> <out-dev-data.sql>
#
# Source: `pg_dump --data-only -n yzy_contracts --no-owner --no-privileges` taken by an
# operator with a read-only role, from a deploy whose migrations match this checkout.
#
# Env:
#   SCRATCH_HOST         required; loopback unless ALLOW_REMOTE_SCRATCH=1
#   SCRATCH_PORT         default 5432
#   SCRATCH_USER         default postgres (superuser on the scratch server)
#   PGPASSWORD           password for the scratch server, read by psql and pg_dump
#   SCRATCH_DB           default yzy_dev_copy_<pid>; must not exist
#   KEEP_SCRATCH=1       keep the scratch database for inspection
set -eu

here=$(cd "$(dirname "$0")" && pwd)
DEV_BUILD=$(cd "$here/.." && pwd)
. "$DEV_BUILD/lib.sh"

[ "$#" -eq 3 ] || die "usage: copy-dev-data.sh <source-data.sql> <dev-owner-uuid> <out.sql>"
source_sql=$1
owner=$2
out=$3

[ -f "$source_sql" ] || die "missing source dump: $source_sql"
valid_uuid "$owner" || die "dev owner is not a UUID"
require_scratch

db=${SCRATCH_DB:-yzy_dev_copy_$$}
tree=
cleanup() {
  [ -n "$tree" ] && rm -rf "$tree"
  if [ "${KEEP_SCRATCH:-0}" != 1 ]; then
    scratch_psql postgres -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

exists=$(scratch_psql postgres -At -c "SELECT count(*) FROM pg_database WHERE datname = '$db'")
[ "$exists" = 0 ] || die "scratch database $db already exists"
scratch_psql postgres -c "CREATE DATABASE \"$db\"" >/dev/null

# 1. Production shape and data, in the scratch database only.
apply_tree "$db" "$REPO" "$REPO/supabase/local/bootstrap.sql" yzy_contracts
scratch_psql "$db" -1 -f "$source_sql" >/dev/null || die "could not load the source dump"

# 2. The DEV owner must exist in the scratch auth stub so the copied references resolve.
scratch_psql "$db" -c "INSERT INTO auth.users (id, email)
  VALUES ('$owner', 'dev-owner@example.invalid') ON CONFLICT (id) DO NOTHING" >/dev/null

# 3. DEV shape: the same migrations, renamed, in yzy_contracts_dev.
tree=$(dev_tree)
apply_tree "$db" "$tree" "$tree/supabase/local/bootstrap.sql" yzy_contracts_dev

# 4. Anonymize yzy_contracts into yzy_contracts_dev, then dump only the DEV schema.
scratch_psql "$db" -v dev_owner="$owner" -f "$DEV_BUILD/dev-copy/anonymize.sql" >/dev/null \
  || die "anonymization failed; nothing was written"

pg_dump "host=$SCRATCH_HOST port=$SCRATCH_PORT user=$SCRATCH_USER dbname=$db" \
  --data-only --no-owner --no-privileges \
  -n yzy_contracts_dev --exclude-table=yzy_contracts_dev._sqlx_migrations \
  -f "$out" || die "pg_dump failed"

echo "dev-copy: wrote $out"
echo "dev-copy: rows per DEV table"
scratch_psql "$db" -At -c "SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'yzy_contracts_dev' AND table_type = 'BASE TABLE'
  AND table_name <> '_sqlx_migrations' ORDER BY 1" |
while read -r table; do
  count=$(scratch_psql "$db" -At -c "SELECT count(*) FROM yzy_contracts_dev.\"$table\"")
  echo "  $table $count"
done
