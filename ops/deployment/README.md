# YZY Contracts production Compose

Use a single Compose project for the API, worker, renderer, portal, and document extractor.

- **Project name:** `yzy-contracts`
- **Services:** `api`, `worker`, `renderer`, `portal`, `doc-extractor`

| Service | Container | Bind |
|---------|-----------|------|
| api | `yzy-contracts-api` | `127.0.0.1:8841` |
| worker | `yzy-contracts-worker` | none |
| renderer | `yzy-contracts-renderer` | none (internal `renderer` network) |
| portal | `yzy-contracts-portal` | `127.0.0.1:8842` |
| doc-extractor | `yzy-contracts-doc-extractor` | loopback port from deployment configuration |

Secrets stay on the host as mode-`0600` files next to Compose: `api.env`, `api.access.env`, `renderer.env`, `doc-extractor.env`. Never commit them.

In `api.env`, set `SUPABASE_JWKS_URL` to the Kong service on the shared Supabase Docker network (for example `http://yzylabs-supabase-kong:8000/auth/v1/.well-known/jwks.json`). Do not use the public `https://supabase.yzylabs.com/...` URL: Cloudflare bot challenges return 403 to the API, `/api/v1/me` becomes 503, and every portal session fails access verification.

Do not run separate Compose projects named `yzy-contracts-api`, `yzy-contracts-portal`, or `doc-extractor-api`. Those directories are retired for runtime.

From the deployment directory, set `SUPABASE_DOCKER_NETWORK` to the external database network in the local `.env` used by Compose.

```bash
docker compose -p yzy-contracts up -d
```

## Deploying (agents and people)

Production deploys only through GitHub Actions (`.github/workflows/deploy.yml`):

1. Commit and push to `main` (changes under `services/api`, `apps/portal` or `supabase/migrations`), or run the workflow by hand.
2. Actions builds the api and portal images from that commit and pushes `ghcr.io/yzylaboratory/yzy-contracts-{api,portal}:sha-<commit>`.
3. Actions connects over SSH with a key that can only run `/opt/yzy/bin/deploy-contracts.sh` (source: `deploy-contracts.sh` here). The script takes `.deploy.lock`, pulls, backs up `yzy_contracts`, runs `migrate`, switches `CONTRACTS_API_IMAGE` / `CONTRACTS_PORTAL_IMAGE` in `.env`, and rolls back if the health checks fail.

The `production-deploy` concurrency group and the lock keep deploys one at a time. History: `/opt/yzy/stacks/yzy-contracts/deploy.log`.

Do not build images on the server, edit `compose.yaml` or `.env` by hand, rsync working trees, or apply SQL directly. Schema changes go in `supabase/migrations/` and reach production through `migrate`.
