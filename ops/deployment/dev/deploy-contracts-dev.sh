#!/usr/bin/env bash
# Isolated DEV deploy for YZY Contracts on Y02/H02.
# Installed at /opt/yzy/bin/deploy-contracts-dev.sh and reached over forced-command SSH.
#
# Usage: deploy-contracts-dev.sh sha-<commit>   (GHCR token on stdin)
# The workflow migrates yzy_contracts_dev on the shared Supabase host first.
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

if ! [[ "$TAG" =~ ^sha-[0-9a-f]{40}$ ]]; then
  echo "usage: deploy-contracts-dev.sh sha-<commit>" >&2
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

set_images() {
  local api_img=$1 portal_img=$2 tmp
  tmp=$(mktemp "$STACK/.env.tmp.XXXXXX") || return
  awk -v api="$api_img" -v portal="$portal_img" '
    BEGIN { found_api = 0; found_portal = 0 }
    /^CONTRACTS_API_IMAGE=/ { print "CONTRACTS_API_IMAGE=" api; found_api = 1; next }
    /^CONTRACTS_PORTAL_IMAGE=/ { print "CONTRACTS_PORTAL_IMAGE=" portal; found_portal = 1; next }
    { print }
    END {
      if (!found_api) print "CONTRACTS_API_IMAGE=" api
      if (!found_portal) print "CONTRACTS_PORTAL_IMAGE=" portal
    }
  ' "$STACK/.env" > "$tmp" || return
  chmod 600 "$tmp" || return
  mv "$tmp" "$STACK/.env" || return
  docker compose -p "$PROJECT" up -d renderer doc-extractor storage-init api worker portal edge
}

healthy() {
  local i=0 worker_state
  while [ "$i" -lt 30 ]; do
    if curl -sf -H "Host: yzycontracts.yzylabs.dev" -o /dev/null "http://127.0.0.1:${EDGE_PORT}/api/v1/health" \
      && curl -sf -H "Host: yzycontracts.yzylabs.dev" -o /dev/null "http://127.0.0.1:${EDGE_PORT}/login"; then
      worker_state=$(docker inspect -f '{{.State.Status}}' yzy-contracts-dev-worker 2>/dev/null || true)
      if [ "$worker_state" = "running" ]; then
        return 0
      fi
    fi
    i=$((i + 1))
    sleep 4
  done
  return 1
}

SWITCHED=1
if set_images "$API" "$PORTAL" && healthy; then
  log "deployed DEV api=$API portal=$PORTAL"
else
  log "health check failed; evaluating rollback"
  if [[ "$PREV_API" == *:sha-* && "$PREV_PORTAL" == *:sha-* ]] \
    && docker image inspect "$PREV_API" "$PREV_PORTAL" >/dev/null 2>&1 \
    && set_images "$PREV_API" "$PREV_PORTAL" && healthy; then
    log "rolled back DEV to api=$PREV_API portal=$PREV_PORTAL"
  else
    log "no prior shared build available for rollback"
  fi
  exit 1
fi
