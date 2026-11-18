# Helpers shared by the anonymized DEV copy and its tests. Sourced, POSIX sh.
# The caller sets DEV_BUILD (services/api/dev-build) before sourcing this file.

REPO=$(cd "$DEV_BUILD/../../.." && pwd)
TRANSFORM="$DEV_BUILD/transform-dev-schema.sh"

die() {
  echo "dev-build: $*" >&2
  exit 1
}

# The scratch server is a throwaway Postgres. It must never be DEV or PROD, so the
# default is loopback only. A dedicated remote scratch host needs an explicit opt-in.
require_scratch() {
  [ -n "${SCRATCH_HOST:-}" ] || die "SCRATCH_HOST is required (a throwaway Postgres server)"
  : "${SCRATCH_PORT:=5432}"
  : "${SCRATCH_USER:=postgres}"
  case "$SCRATCH_HOST" in
    127.0.0.1 | localhost | ::1) ;;
    *)
      [ "${ALLOW_REMOTE_SCRATCH:-0}" = 1 ] \
        || die "SCRATCH_HOST must be loopback; set ALLOW_REMOTE_SCRATCH=1 only for a dedicated scratch server"
      ;;
  esac
  export SCRATCH_PORT SCRATCH_USER
}

# scratch_psql DB [psql args...]: connects with SCRATCH_* and PGPASSWORD from the env.
scratch_psql() {
  _sp_db=$1
  shift
  psql "host=$SCRATCH_HOST port=$SCRATCH_PORT user=$SCRATCH_USER dbname=$_sp_db" \
    -v ON_ERROR_STOP=1 -q "$@"
}

# apply_tree DB ROOT BOOTSTRAP LEDGER_SCHEMA: bootstrap, then the sqlx ledger, then each
# migration in version order, one transaction per file, as sqlx runs them.
apply_tree() {
  _at_db=$1
  _at_root=$2
  _at_boot=$3
  _at_schema=$4
  scratch_psql "$_at_db" -f "$_at_boot" >/dev/null || die "bootstrap failed: $_at_boot"
  scratch_psql "$_at_db" -c "CREATE TABLE IF NOT EXISTS $_at_schema._sqlx_migrations (
      version BIGINT PRIMARY KEY, description TEXT NOT NULL,
      installed_on TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL,
      checksum BYTEA NOT NULL, execution_time BIGINT NOT NULL)" >/dev/null
  for _at_file in "$_at_root"/supabase/migrations/*.sql; do
    scratch_psql "$_at_db" -1 -f "$_at_file" >/dev/null || die "migration failed: $_at_file"
  done
}

# dev_tree: prints a temporary tree with the DEV rename applied to the API sources,
# the migrations and the bootstrap. The repository itself is never modified.
dev_tree() {
  _dt_tree=$(mktemp -d "${TMPDIR:-/tmp}/yzy-dev-tree.XXXXXX")
  mkdir -p "$_dt_tree/services/api" "$_dt_tree/supabase/local"
  cp -R "$REPO/services/api/src" "$_dt_tree/services/api/src"
  cp -R "$REPO/supabase/migrations" "$_dt_tree/supabase/migrations"
  sh "$TRANSFORM" apply "$_dt_tree" >/dev/null || die "DEV rename failed"
  sh "$TRANSFORM" bootstrap "$REPO/supabase/local/bootstrap.sql" >"$_dt_tree/supabase/local/bootstrap.sql" \
    || die "DEV bootstrap failed"
  printf "%s\n" "$_dt_tree"
}

valid_uuid() {
  printf '%s' "$1" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
}
