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
REPO=yzylaboratory/yzy-contracts
NOTIFY_TO=admin@yzylabs.com
ARGS=${SSH_ORIGINAL_COMMAND:-$*}
MODE=deploy
case "$ARGS" in
  "build-failed "*) MODE=build-failed; TAG=${ARGS#build-failed } ;;
  *) TAG=$ARGS ;;
esac

case "$TAG" in
  sha-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) echo "usage: deploy-contracts.sh sha-<commit>" >&2; exit 2 ;;
esac
if printf '%s' "$TAG" | grep -q '[^a-z0-9-]'; then echo "invalid tag" >&2; exit 2; fi

cd "$STACK"

# Deploy notices go through YZY Notifications (same contract as the API).
notify() {
  STATUS=$1 DETAIL=$2 SHA=${TAG#sha-} PREV_SHA=${PREV_SHA:-} REPO=$REPO TO=$NOTIFY_TO \
  TOKEN_NOTIFY=$(grep -oP '^YZY_NOTIFICATIONS_TOKEN=\K.*' api.env) \
  python3 - <<'PY' || echo "notification failed" >&2
import json, os, time, urllib.request
e = os.environ
sha, short = e["SHA"], e["SHA"][:7]
author = title = "?"
def get(url):
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.load(r)
try:
    c = get(f"https://api.github.com/repos/{e['REPO']}/commits/{sha}")["commit"]
    author, title = c["author"]["name"], c["message"].splitlines()[0]
except Exception:
    pass
# Every commit since the version that was running, with its body bullets.
included = []
prev = e.get("PREV_SHA", "")
try:
    commits = (get(f"https://api.github.com/repos/{e['REPO']}/compare/{prev}...{sha}")["commits"]
               if prev and prev != sha else [get(f"https://api.github.com/repos/{e['REPO']}/commits/{sha}")])
    for item in commits:
        lines = item["commit"]["message"].splitlines()
        if lines[0].startswith("Merge "):
            continue
        included.append(f"{lines[0]} ({item['sha'][:7]}, {item['commit']['author']['name']})")
        for line in lines[1:]:
            line = line.strip()
            if line.startswith(("- ", "* ")):
                included.append(f"  - {line[2:]}")
except Exception:
    included.append("(no se pudo leer el historial de GitHub)")
body = {
    "product": "yzy-contracts",
    "to": [e["TO"]],
    "subject": f"[Contracts] {e['STATUS']} · {short} · {title}"[:200],
    "text": "\n".join([
        f"Estado: {e['STATUS']}",
        f"Commit: {short} - {title}",
        f"Autor: {author}",
        f"Detalle: {e['DETAIL']}",
        "",
        "Lo que incluye:",
        *[f"- {line}" if not line.startswith("  ") else line for line in included],
        "",
        f"Commit: https://github.com/{e['REPO']}/commit/{sha}",
        f"Actions: https://github.com/{e['REPO']}/actions/workflows/deploy.yml",
    ]),
    "kind": "deploy",
}
req = urllib.request.Request(
    "http://127.0.0.1:8860/v1/emails", data=json.dumps(body).encode(), method="POST",
    headers={
        "Content-Type": "application/json",
        "X-Internal-Service-Token": e["TOKEN_NOTIFY"],
        "X-Yzy-Source-Service": "yzy-contracts-deploy",
        "Idempotency-Key": f"deploy-{sha}-{int(time.time() * 1000)}",
    })
urllib.request.urlopen(req, timeout=15).read()
PY
}

if [ "$MODE" = build-failed ]; then
  notify "Falló el build" "GitHub Actions no pudo construir las imágenes; producción no cambió."
  exit 0
fi

exec 9>.deploy.lock
echo "waiting for deploy lock..."
flock -w 3600 9 || { echo "deploy lock timeout" >&2; exit 1; }

log() { echo "$(date -u +%FT%TZ) $TAG $*" | tee -a "$LOG"; }

API="$REGISTRY/yzy-contracts-api:$TAG"
PORTAL="$REGISTRY/yzy-contracts-portal:$TAG"

# Pull with the job's short-lived token; nothing is stored on the host.
TOKEN=$(cat)
CFG=$(mktemp -d)
trap 'rc=$?; rm -rf "$CFG"; [ $rc -ne 0 ] && [ "$SWITCHED" = 0 ] && notify "Falló" "El despliegue se detuvo antes de cambiar de versión (código $rc); producción sigue igual."' EXIT
SWITCHED=0
printf '%s' "$TOKEN" | DOCKER_CONFIG=$CFG docker login ghcr.io -u github-actions --password-stdin >/dev/null
DOCKER_CONFIG=$CFG docker pull -q "$API"
DOCKER_CONFIG=$CFG docker pull -q "$PORTAL"
log "pulled"

PREV_API=$(grep -oP '^CONTRACTS_API_IMAGE=\K.*' .env)
PREV_PORTAL=$(grep -oP '^CONTRACTS_PORTAL_IMAGE=\K.*' .env)
PREV_SHA=$(printf '%s' "$PREV_API" | grep -oP ':sha-\K[0-9a-f]+$' || true)
notify "Desplegando" "Imágenes descargadas; respaldo, migraciones y cambio de versión en curso."

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

SWITCHED=1
set_images "$API" "$PORTAL"
if healthy; then
  log "deployed api=$API portal=$PORTAL"
  notify "Desplegado" "API y portal en $TAG; health OK."
else
  log "health check failed; rolling back to $PREV_API $PREV_PORTAL"
  set_images "$PREV_API" "$PREV_PORTAL"
  notify "Falló y se revirtió" "El health check falló; volvió a $PREV_API y $PREV_PORTAL."
  exit 1
fi
