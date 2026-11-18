#!/usr/bin/env bash
# Isolated DEV deploy for YZY Contracts on Y02/H02.
# Installed at /opt/yzy/bin/deploy-contracts-dev.sh and reached over forced-command SSH.
#
# Usage: deploy-contracts-dev.sh dev-sha-<commit>   (GHCR token on stdin)
# Uses own lock (.deploy-dev.lock), pulls dev-sha-<commit> tags from the same GHCR
# packages as PROD, backs up & migrates yzy_contracts_dev, and rolls back on health failure.
set -euo pipefail
umask 077

STACK=${CONTRACTS_DEV_STACK_DIR:-/opt/yzy/stacks/yzy-contracts-dev}
PROJECT=${CONTRACTS_DEV_COMPOSE_PROJECT:-yzy-contracts-dev}
REGISTRY=ghcr.io/yzylaboratory
LOG=$STACK/deploy-dev.log

ARGS=${SSH_ORIGINAL_COMMAND:-$*}
MODE=deploy
case "$ARGS" in
  "build-failed "*) MODE=build-failed; TAG=${ARGS#build-failed } ;;
  *) TAG=$ARGS ;;
esac

if ! [[ "$TAG" =~ ^dev-sha-[0-9a-f]{7,40}$ ]]; then
  echo "usage: deploy-contracts-dev.sh dev-sha-<commit>" >&2
  exit 2
fi

cd "$STACK"

log() {
  printf '%s %s %s\n' "$(date -u +%FT%TZ)" "$TAG" "$*" | tee -a "$LOG"
}

if [ "$MODE" = "build-failed" ]; then
  log "build failed in CI; DEV stack unchanged"
  exit 0
fi

exec 9>"$STACK/.deploy-dev.lock"
echo "waiting for dev deploy lock..."
flock -w 1800 9 || { echo "dev deploy lock timeout" >&2; exit 1; }

API="$REGISTRY/yzy-contracts-api:$TAG"
PORTAL="$REGISTRY/yzy-contracts-portal:$TAG"

TOKEN=$(cat)
if [ -z "${TOKEN//[$' \t\r\n']/}" ]; then
  echo "GHCR token must be provided on stdin" >&2
  exit 2
fi

CFG=$(mktemp -d)
SWITCHED=0
cleanup() {
  rc=$?
  rm -rf "$CFG"
  if [ "$rc" -ne 0 ] && [ "$SWITCHED" = "0" ]; then
    log "failed before switching images (rc=$rc); DEV stack unchanged"
  fi
}
trap cleanup EXIT

printf '%s' "$TOKEN" | DOCKER_CONFIG="$CFG" docker login ghcr.io -u github-actions --password-stdin >/dev/null
DOCKER_CONFIG="$CFG" docker pull -q "$API"
DOCKER_CONFIG="$CFG" docker pull -q "$PORTAL"
log "pulled api=$API portal=$PORTAL"

env_get() {
  local file=$1 key=$2
  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}

PREV_API=$(env_get .env CONTRACTS_API_IMAGE)
PREV_PORTAL=$(env_get .env CONTRACTS_PORTAL_IMAGE)
EDGE_PORT=$(env_get .env DEV_EDGE_BIND_PORT)
EDGE_PORT=${EDGE_PORT:-8850}

PG_PW=$(env_get db.env POSTGRES_PASSWORD)
SID=$(env_get api.access.env CONTRACTS_SUPERADMIN_ID)
if [ -z "$PG_PW" ] || [ -z "$SID" ]; then
  echo "POSTGRES_PASSWORD (db.env) and CONTRACTS_SUPERADMIN_ID (api.access.env) are required" >&2
  exit 1
fi

# Ensure isolated DEV DB is healthy and bootstrapped before backup/migration.
docker compose -p "$PROJECT" up -d db
docker compose -p "$PROJECT" run --rm db-init

mkdir -p "$STACK/backups"
docker compose -p "$PROJECT" exec -T db \
  pg_dump -U postgres -Fc -n yzy_contracts_dev > "$STACK/backups/yzy_contracts_dev.pre-$TAG.dump"
log "backed up yzy_contracts_dev"

# Run SQLx migrations using the newly pulled DEV API image (built with CONTRACTS_BUILD_ENV=development).
CONTRACTS_API_IMAGE="$API" docker compose -p "$PROJECT" run --rm --no-deps \
  -e MIGRATION_DATABASE_URL="postgres://postgres:${PG_PW}@db:5432/postgres" \
  -e CONTRACTS_SUPERADMIN_ID="$SID" \
  api migrate
log "migrated yzy_contracts_dev"

# Re-run idempotent db-init in case migrations created yzy_contracts_dev_app with NOLOGIN.
docker compose -p "$PROJECT" run --rm db-init

set_images() {
  local api_img=$1 portal_img=$2 tmp
  tmp=$(mktemp "$STACK/.env.tmp.XXXXXX")
  awk -v api="$api_img" -v portal="$portal_img" '
    BEGIN { found_api = 0; found_portal = 0 }
    /^CONTRACTS_API_IMAGE=/ { print "CONTRACTS_API_IMAGE=" api; found_api = 1; next }
    /^CONTRACTS_PORTAL_IMAGE=/ { print "CONTRACTS_PORTAL_IMAGE=" portal; found_portal = 1; next }
    { print }
    END {
      if (!found_api) print "CONTRACTS_API_IMAGE=" api
      if (!found_portal) print "CONTRACTS_PORTAL_IMAGE=" portal
    }
  ' "$STACK/.env" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$STACK/.env"
  docker compose -p "$PROJECT" up -d auth renderer doc-extractor storage-init api worker portal edge
}

healthy() {
  local i=0 admin_code worker_state
  while [ "$i" -lt 30 ]; do
    if curl -sf -H "Host: yzycontracts.yzylabs.dev" -o /dev/null "http://127.0.0.1:${EDGE_PORT}/api/v1/health" \
      && curl -sf -H "Host: yzycontracts.yzylabs.dev" -o /dev/null "http://127.0.0.1:${EDGE_PORT}/login" \
      && curl -sf -H "Host: yzycontracts.yzylabs.dev" -o /dev/null "http://127.0.0.1:${EDGE_PORT}/auth/v1/health"; then
      admin_code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: yzycontracts.yzylabs.dev" \
        "http://127.0.0.1:${EDGE_PORT}/auth/v1/admin/users" || true)
      worker_state=$(docker inspect -f '{{.State.Status}}' yzy-contracts-dev-worker 2>/dev/null || true)
      if [ "$admin_code" = "403" ] && [ "$worker_state" = "running" ]; then
        return 0
      fi
    fi
    i=$((i + 1))
    sleep 4
  done
  return 1
}

SWITCHED=1
set_images "$API" "$PORTAL"

if healthy; then
  log "deployed DEV api=$API portal=$PORTAL"
else
  log "health check failed; evaluating rollback"
  if docker image inspect "$PREV_API" "$PREV_PORTAL" >/dev/null 2>&1; then
    set_images "$PREV_API" "$PREV_PORTAL"
    log "rolled back DEV to api=$PREV_API portal=$PREV_PORTAL"
  else
    log "no valid previous image tags in .env; manual recovery required"
  fi
  exit 1
fi
