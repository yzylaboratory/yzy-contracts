# YZY Contracts DEV

DEV uses the same commit-tagged API and portal images as production. GitHub Actions builds both images once, migrates `yzy_contracts_dev` on the shared Supabase host, and deploys DEV automatically. The production job promotes the same images after approval.

- **Portal:** `https://yzycontracts.yzylabs.dev` on H02. Its API requests use same-origin `/api/v1`.
- **Auth:** `https://supabase.yzylabs.com`. The shared Google configuration accepts the exact DEV callback `https://yzycontracts.yzylabs.dev/auth/callback`. Browser sessions are scoped to their portal origin.
- **Data:** `yzy_contracts_dev` in shared Supabase Postgres on H01. The DEV API connects over private TLS as `yzy_contracts_dev_app` with no access to the production schema. The migration owner credential stays on H01.
- **Files:** The dedicated DEV bucket accepts private API calls and signed HTTPS object transfers through the DEV edge. DEV uses its own bucket, renderer, and extractor settings.

## Deployment configuration

1. On H01, install `shared-supabase/deploy-dev-schema.sh` as `/opt/yzy/bin/deploy-yzy-contracts-dev-schema.sh`. Copy `bootstrap/` and `shared-supabase/` into `/opt/yzy/stacks/yzy-contracts-dev-supabase`. Generate `dev-runtime-password` there with `openssl rand -hex 32` and mode 0600.
2. Start the JWKS bridge with `docker compose up -d` from `shared-supabase/`. Supply `SUPABASE_PRIVATE_BIND` and `DEV_PEER_IP` with the two private addresses. The endpoint only serves the shared Auth public signing keys to H02. PostgreSQL uses the existing private TLS listener on the shared host.
3. On H02, provision `compose.yaml`, `edge/nginx.conf` and the private API env files from the DEV examples. Copy the TLS endpoint's CA to `shared-postgres-ca.crt`. The runtime settings in `api.env` select `yzy_contracts_dev`, the shared issuer and the private JWKS endpoint. Set `CONTRACTS_ALLOWED_USER_IDS` with the two confirmed shared Auth UUIDs, and `CONTRACTS_SUPERADMIN_ID` with the shared admin UUID.
4. Install `deploy-contracts-dev.sh` as `/opt/yzy/bin/deploy-contracts-dev.sh` on H02. The `development` GitHub environment needs its H01 schema key and known hosts (`DEV_SCHEMA_SSH_KEY`, `DEV_SCHEMA_KNOWN_HOSTS`, `DEV_SCHEMA_DEPLOY_HOST`) and its H02 app deploy key and known hosts (`DEV_DEPLOY_SSH_KEY`, `DEV_DEPLOY_KNOWN_HOSTS`, `DEV_DEPLOY_HOST`). Each SSH key is restricted to one deployment command.
5. Set the DEV edge ingress target to `http://yzy-contracts-dev-edge:8080` through the private Docker tunnel network on H02.

## Data and rollback

On first cutover, the H01 deploy command can restore the existing DEV-only `legacy-dev.sql` staged in the stack directory with its two user UUIDs remapped to the shared identities. It aborts unless the migrated DEV schema is empty. The command moves the dump into `backups/` when it succeeds.

For a new anonymized copy, run `scripts/export-case-shapes.sql` on the shared Postgres with `psql -XqAt -v ON_ERROR_STOP=1` and pipe its output into `scripts/load-case-shapes.sh` on H01. Only synthetic company, client and case data is exported. The loader rejects an already populated DEV schema.

Each migration backs up `yzy_contracts_dev` under the H01 stack's `backups/` directory. On a failed H02 health check, the deploy script restores the preceding shared images when available.
