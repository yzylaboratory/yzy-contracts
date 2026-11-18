# YZY Contracts — Isolated DEV Deployment (`yzycontracts.yzylabs.dev`)

Isolated development stack for YZY Contracts designed for **Y02 (`yzy-node-02`)** or **H02 (`hetzner-node-02`)**. It never shares databases, Auth users, object storage, networks, locks, or deploy notifications with production (`hetzner-node-01` / `yzy-contracts`).

## 1. Topology and Isolation

- **Compose project:** `yzy-contracts-dev`
- **Host stack path:** `/opt/yzy/stacks/yzy-contracts-dev`
- **Public origin (same-origin edge):** `https://yzycontracts.yzylabs.dev`
- **Database schema & runtime role:** `yzy_contracts_dev` / `yzy_contracts_dev_app` (requires API images built with `CONTRACTS_BUILD_ENV=development`)

| Service | Image | Network(s) | Host Bind | Notes |
|---|---|---|---|---|
| `edge` | `nginxinc/nginx-unprivileged:1.27-alpine` | `edge-net`, `tunnel` | `127.0.0.1:8850` | Loopback for host checks; Cloudflare uses the shared tunnel network |
| `portal` | `ghcr.io/yzylaboratory/yzy-contracts-portal:dev-sha-*` | `edge-net` | none | Next.js standalone |
| `api` | `ghcr.io/yzylaboratory/yzy-contracts-api:dev-sha-*` | `db-net`, `renderer`, `edge-net`, `egress-net` | none | Rust API (`serve`) |
| `worker` | `ghcr.io/yzylaboratory/yzy-contracts-api:dev-sha-*` | `db-net`, `extractor`, `edge-net`, `egress-net` | none | Conversion + billing worker (`worker`) |
| `auth` | `supabase/gotrue:v2.197.0` | `db-net`, `edge-net` | none | Dedicated DEV GoTrue; `/auth/v1/admin*` blocked at `edge` |
| `db` | `supabase/postgres:17.6.1.136` | `db-net` (`internal: true`) | none | Isolated DEV Postgres; no internet egress, no host port |
| `db-init` | `supabase/postgres:17.6.1.136` | `db-net` (`internal: true`) | none | One-shot idempotent schema & role bootstrap |
| `renderer` | `${CONTRACTS_RENDERER_IMAGE}` | `renderer` (`internal: true`) | none | LibreOffice DOCX→PDF renderer; no internet egress |
| `doc-extractor` | `${CONTRACTS_EXTRACTOR_IMAGE}` | `extractor` | none | Docling + OCR extractor (`mem_limit: 4g`) |
| `storage` *(profile `local-s3`)* | `chrislusf/seaweedfs:4.53` | `edge-net` | none | Isolated S3; the edge accepts signed object requests only |

## 2. Same-Origin Edge Routing (`edge/nginx.conf`)

All browser and API traffic enters through `https://yzycontracts.yzylabs.dev`:

- `/api/v1/*` → `http://api:8080` (preserves full `/api/v1/...` path; `client_max_body_size 32m`; `proxy_read_timeout 120s`)
- `/auth/v1/admin`, `/auth/v1/admin/*`, `/auth/v1/invite`, `/auth/v1/invite/*` → **403 Forbidden** (Auth admin never exposed externally)
- `/rest/v1/*`, `/storage/v1/*`, `/pg/*`, `/studio/*` → **404 Not Found**
- `/auth/v1/*` → `http://auth:9999` (rewrites `/auth/v1/(.*)` → `/$1` and sends `X-Forwarded-Prefix: /auth/v1`, `X-Forwarded-Proto`, `X-Forwarded-Host`)
- `/yzy-contracts-dev/<object>` → `http://storage:9000` for signed object requests only; the bucket root and anonymous access are blocked.
- `/*` (including `/login` and the Next.js `/auth/callback` page) → `http://portal:3000`

Nginx uses Docker's embedded DNS (`resolver 127.0.0.11 valid=10s ipv6=off`) with upstream variables so rolling restarts of `api`, `portal`, or `auth` never leave stale IPs.

## 3. Auth, JWKS, and DEV Policy

- **Asymmetric JWT / JWKS (`services/api/src/modules/auth/jwt.rs`):** The Rust API rejects HS256 user tokens and requires `ES256` or `RS256` keys with a `kid` fetched from `SUPABASE_JWKS_URL`.
  - `auth` runs `supabase/gotrue:v2.197.0` (pinned per `yzy-infra` Supabase blueprint commit `831d6302`) with an ES256 EC P-256 JWK in `GOTRUE_JWT_KEYS`.
  - `api` fetches JWKS internally over `http://auth:9999/.well-known/jwks.json` (no Cloudflare hairpin/bot-challenge issues) while validating `iss = https://yzycontracts.yzylabs.dev/auth/v1` and `aud = authenticated`.
- **Invite-only / DEV policy:**
  - `GOTRUE_DISABLE_SIGNUP=true`, `GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false`, `GOTRUE_MAILER_AUTOCONFIRM=true`.
  - **No real outbound emails:** GoTrue has no real SMTP configured, and `api.env` omits `YZY_NOTIFICATIONS_URL`, `YZY_NOTIFICATIONS_TOKEN`, and `BILLING_PORTAL_URL` (`Config::billing_mail` stays `None`).
  - **No real billing bank details:** `api.env` omits `CONTRACTS_BILLING_*` bank variables.
  - DEV accounts sign in at `/login` with an email and password created in DEV Auth. Account creation is only available inside the stack.

## 4. Storage and Extractor / Renderer Dependencies

- **`renderer`** communicates exclusively with `api` on the internal `renderer` network (`http://renderer:8080/v1/render/pdf`). It has no external dependencies and works identically in DEV.
- **`doc-extractor`** (`doc-extractor-api/app/services/document_downloader.py`) strictly enforces `https://` on port `443`, exact hostname matching `R2_ALLOWED_HOSTS`, and non-private/non-loopback DNS resolution. In addition, the portal uploads files directly from the browser to the presigned `R2_ENDPOINT` URL.
  - The included SeaweedFS bucket uses signed HTTPS URLs at `https://yzycontracts.yzylabs.dev/yzy-contracts-dev/<object>`. The API reads, inspects and deletes objects directly on the private network through `R2_INTERNAL_ENDPOINT`. Nginx preserves the signed Host and disables caching.

## 5. Exact Host & DNS Bootstrap Sequence (Root / Operator)

Run on the target DEV node (**Y02** or **H02**). Never copy files or credentials from PROD (`hetzner-node-01`).

1. **Create stack directory & install deploy script:**
   ```bash
   install -d -m 750 /opt/yzy/stacks/yzy-contracts-dev/{edge,bootstrap,backups}
   install -d -m 755 /opt/yzy/bin
   # Copy compose.yaml, edge/nginx.conf, bootstrap/{init-dev-db.sh,bootstrap.sql} into /opt/yzy/stacks/yzy-contracts-dev/
   # Install deploy-contracts-dev.sh as /opt/yzy/bin/deploy-contracts-dev.sh (chmod 0755)
   chmod 755 /opt/yzy/stacks/yzy-contracts-dev/bootstrap/init-dev-db.sh
   ```

2. **Create mode-`0600` configuration:** Run `python3 scripts/provision-dev-env.py .` from the stack directory once. It creates fresh DEV credentials and signing keys.

3. **Configure the public Auth key:** Set the repository variable `DEV_NEXT_PUBLIC_SUPABASE_ANON_KEY` using that value from `auth-admin.env`. Keep the service role key in the private host file.

4. **Load helper images:** Load the versioned renderer and extractor image artifacts on the host or set `CONTRACTS_RENDERER_IMAGE` and `CONTRACTS_EXTRACTOR_IMAGE` to their published registry tags.

5. **Provision Cloudflare Tunnel + DNS (`yzylabs.dev` zone):**
   - Add an ingress rule in the tunnel's active Cloudflare configuration routing `yzycontracts.yzylabs.dev` → `http://yzy-contracts-dev-edge:8080` on `DEV_TUNNEL_NETWORK` (keep catch-all `http_status:404` last).
   - Create the proxied CNAME for `yzycontracts.yzylabs.dev` using **`yzylabs.dev`** zone credentials (note from `yzy-infra`: `~/.cloudflared/cert.pem` is bound to `yzylabs.com`, so `cloudflared tunnel route dns` cannot create `*.yzylabs.dev` records).

6. **Configure forced-command SSH key for GitHub Actions DEV deploy:**
   In `/root/.ssh/authorized_keys` (or dedicated deploy user with Docker access), add a **separate** DEV public key:
   ```text
   command="/opt/yzy/bin/deploy-contracts-dev.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 <DEV_DEPLOY_PUBLIC_KEY>
   ```

7. **Create the isolated DEV superadmin user in GoTrue & `api.access.env`:**
   ```bash
   cd /opt/yzy/stacks/yzy-contracts-dev
   docker compose -p yzy-contracts-dev up -d db
   docker compose -p yzy-contracts-dev run --rm db-init
   docker compose -p yzy-contracts-dev up -d auth
   # Wait for GoTrue to report healthy, then enter a unique DEV password at the prompt.
   python3 scripts/provision-dev-user.py dev-admin@example.net --superadmin
   ```

8. **CI image build contract (shared GHCR packages, `dev-sha-<commit>` tags):**
   - Build `api` with `--build-arg CONTRACTS_BUILD_ENV=development` → push `ghcr.io/yzylaboratory/yzy-contracts-api:dev-sha-<commit>`
   - Build `portal` with:
     - `NEXT_PUBLIC_SUPABASE_URL=https://yzycontracts.yzylabs.dev`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY=<DEV_SUPABASE_ANON_KEY>`
     - `NEXT_PUBLIC_API_URL=https://yzycontracts.yzylabs.dev`
     - `NEXT_PUBLIC_SITE_URL=https://yzycontracts.yzylabs.dev`
     → push `ghcr.io/yzylaboratory/yzy-contracts-portal:dev-sha-<commit>`
   - Trigger forced-SSH deploy:
     ```bash
     printf '%s' "$GHCR_TOKEN" | ssh -i ~/.ssh/deploy_dev root@<DEV_HOST> "dev-sha-<commit>"
     ```

## 6. Anonymized Case Copy (No Real Files / Proofs / Auth)

Keep the source snapshot inside production infrastructure. Export only rewritten company, client and case values. Never import an original dump into DEV. DEV accounts and all original uploads, generated documents, and payment evidence are outside the copy.

After the first DEV migration, run the read-only export and stream its output to the DEV loader. The loader requires an empty DEV database and creates synthetic billing accounts that start on the first day of the following month.

```bash
set -o pipefail
ssh <source-host> 'docker exec -i <source-db> psql -XqAt -U <reader> -d postgres -v ON_ERROR_STOP=1' \
  < ops/deployment/dev/scripts/export-case-shapes.sql \
  | ssh <dev-host> 'bash /opt/yzy/stacks/yzy-contracts-dev/scripts/load-case-shapes.sh'
```

## 7. Rollback

- **Automatic rollback:** `deploy-contracts-dev.sh` restores `PREV_API` / `PREV_PORTAL` in `.env` and restarts `api`, `worker`, `portal` if healthchecks fail.
- **Database schema rollback:** Restore the pre-migration dump created by `deploy-contracts-dev.sh`:
  ```bash
  docker compose -p yzy-contracts-dev stop api worker
  docker compose -p yzy-contracts-dev exec -T db \
    pg_restore -U postgres -d postgres --clean --if-exists -n yzy_contracts_dev \
    < /opt/yzy/stacks/yzy-contracts-dev/backups/yzy_contracts_dev.pre-<tag>.dump
  ```
