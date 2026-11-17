#!/bin/sh
# Production deploy for YZY Contracts. The only supported way to change the
# api, worker and portal images. Installed at /opt/yzy/bin/deploy-contracts.sh
# and reached by GitHub Actions through a forced-command SSH key.
#
# Usage: deploy-contracts.sh sha-<commit>   (GHCR token on stdin)
# One deploy at a time (flock); the next one waits its turn.
set -eu

STACK=/opt/yzy/stacks/yzy-contracts
REGISTRY=ghcr.io/yzylaboratory
LOG=$STACK/deploy.log
TAG=${SSH_ORIGINAL_COMMAND:-${1:-}}

case "$TAG" in
  sha-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) echo "usage: deploy-contracts.sh sha-<commit>" >&2; exit 2 ;;
esac
if printf '%s' "$TAG" | grep -q '[^a-z0-9-]'; then echo "invalid tag" >&2; exit 2; fi

cd "$STACK"
exec 9>.deploy.lock
echo "waiting for deploy lock..."
flock -w 3600 9 || { echo "deploy lock timeout" >&2; exit 1; }

log() { echo "$(date -u +%FT%TZ) $TAG $*" | tee -a "$LOG"; }

API="$REGISTRY/yzy-contracts-api:$TAG"
PORTAL="$REGISTRY/yzy-contracts-portal:$TAG"

# Pull with the job's short-lived token; nothing is stored on the host.
TOKEN=$(cat)
CFG=$(mktemp -d)
trap 'rm -rf "$CFG"' EXIT
printf '%s' "$TOKEN" | DOCKER_CONFIG=$CFG docker login ghcr.io -u github-actions --password-stdin >/dev/null
DOCKER_CONFIG=$CFG docker pull -q "$API"
DOCKER_CONFIG=$CFG docker pull -q "$PORTAL"
log "pulled"

PREV_API=$(grep -oP '^CONTRACTS_API_IMAGE=\K.*' .env)
PREV_PORTAL=$(grep -oP '^CONTRACTS_PORTAL_IMAGE=\K.*' .env)

docker exec yzylabs-supabase-db pg_dump -U postgres -Fc -n yzy_contracts > "backups/yzy_contracts.pre-$TAG.dump"

NET=$(grep -oP '^SUPABASE_DOCKER_NETWORK=\K.*' .env)
PW=$(grep -oP '^POSTGRES_PASSWORD=\K.*' /root/yzylabs-supabase/.env)
SID=$(grep -oP '^CONTRACTS_SUPERADMIN_ID=\K.*' api.access.env)
docker run --rm --network "$NET" --env-file api.env \
  -e MIGRATION_DATABASE_URL="postgres://postgres:$PW@yzylabs-supabase-db:5432/postgres" \
  -e CONTRACTS_SUPERADMIN_ID="$SID" "$API" migrate
log "migrated"

set_images() {
  sed -i "s#^CONTRACTS_API_IMAGE=.*#CONTRACTS_API_IMAGE=$1#; s#^CONTRACTS_PORTAL_IMAGE=.*#CONTRACTS_PORTAL_IMAGE=$2#" .env
  docker compose -p yzy-contracts up -d --no-deps api worker portal
}

healthy() {
  i=0
  while [ $i -lt 30 ]; do
    if curl -sf -o /dev/null http://127.0.0.1:8841/api/v1/health \
      && curl -sf -o /dev/null http://127.0.0.1:8842/login; then return 0; fi
    i=$((i + 1)); sleep 4
  done
  return 1
}

set_images "$API" "$PORTAL"
if healthy; then
  log "deployed api=$API portal=$PORTAL"
else
  log "health check failed; rolling back to $PREV_API $PREV_PORTAL"
  set_images "$PREV_API" "$PREV_PORTAL"
  exit 1
fi
