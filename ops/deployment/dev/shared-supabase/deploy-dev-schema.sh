#!/usr/bin/env bash
# H01 forced command. Only the private DEV schema is backed up and migrated.
set -euo pipefail
umask 077

stack=/opt/yzy/stacks/yzy-contracts-dev-supabase
db=yzylabs-supabase-db
registry=ghcr.io/yzylaboratory
tag=${SSH_ORIGINAL_COMMAND:-$*}

if ! [[ "$tag" =~ ^sha-[0-9a-f]{40}$ ]]; then
  echo "usage: deploy-dev-schema.sh sha-<commit>" >&2
  exit 2
fi

cd "$stack"
exec 9>.deploy-schema.lock
flock -w 1200 9

registry_token=$(cat)
: "${registry_token:?GHCR token is required on stdin}"
docker_config=$(mktemp -d)
trap 'rm -f "$docker_config/config.json"; rmdir "$docker_config"' EXIT
printf '%s' "$registry_token" | docker --config "$docker_config" login ghcr.io -u github-actions --password-stdin >/dev/null
image="$registry/yzy-contracts-api:$tag"
docker --config "$docker_config" pull -q "$image"

psql_dev() {
  docker exec -i "$db" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

owner=$(psql_dev -Atc "SELECT id FROM auth.users WHERE email = 'admin@yzylabs.com' AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL")
[[ "$owner" =~ ^[[:xdigit:]]{8}-([[:xdigit:]]{4}-){3}[[:xdigit:]]{12}$ ]]
export CONTRACTS_SUPERADMIN_ID="$owner"

if [[ $(psql_dev -Atc "SELECT to_regnamespace('yzy_contracts') IS NOT NULL") != t ]]; then
  echo "Expected the shared Supabase Postgres" >&2
  exit 1
fi
mkdir -p backups
if [[ $(psql_dev -Atc "SELECT to_regnamespace('yzy_contracts_dev') IS NOT NULL") == t ]]; then
  docker exec "$db" pg_dump -U postgres -Fc -n yzy_contracts_dev > "backups/dev-pre-$tag.dump"
fi

export CONTRACTS_DATABASE_SCHEMA=yzy_contracts_dev
db_password=$(sed -n 's/^POSTGRES_PASSWORD=//p' /root/yzylabs-supabase/.env)
: "${db_password:?Shared PostgreSQL password is missing}"
export MIGRATION_DATABASE_URL="postgres://postgres:$db_password@$db:5432/postgres"

if [[ $(psql_dev -Atc "SELECT to_regclass('yzy_contracts_dev.profiles') IS NOT NULL") != t ]]; then
  psql_dev < bootstrap/create-dev-role.sql
  psql_dev < bootstrap/bootstrap.sql
fi

docker run --rm --network yzylabs-supabase_default \
  -e CONTRACTS_SUPERADMIN_ID -e CONTRACTS_DATABASE_SCHEMA -e MIGRATION_DATABASE_URL "$image" migrate

app_password=$(cat dev-runtime-password)
[[ "$app_password" =~ ^[a-f0-9]{64}$ ]]
{
  printf "\\set app_password '%s'\n" "$app_password"
  cat bootstrap/set-dev-role-password.sql
} | psql_dev

if [[ -f legacy-dev.sql && ! -f .legacy-dev-imported ]]; then
  {
    cat bootstrap/restore-dev-prelude.sql
    cat legacy-dev.sql
  } | docker exec -i "$db" psql -X -q -U supabase_admin -d postgres \
    -v ON_ERROR_STOP=1 --single-transaction -f -
  touch .legacy-dev-imported
  mv legacy-dev.sql backups/legacy-dev.sql
fi

python3 bootstrap/allow-dev-oauth-redirect.py
echo "DEV schema migrated for $tag"
