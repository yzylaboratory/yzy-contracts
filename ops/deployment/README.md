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

Do not run separate Compose projects named `yzy-contracts-api`, `yzy-contracts-portal`, or `doc-extractor-api`. Those directories are retired for runtime.

From the deployment directory, set `SUPABASE_DOCKER_NETWORK` to the external database network in the local `.env` used by Compose.

```bash
docker compose -p yzy-contracts up -d
```
