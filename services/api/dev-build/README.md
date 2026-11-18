# Instancia DEV aislada de la API

Esta carpeta permite levantar la API contra una instancia Supabase/Auth **DEV** en otro host, con su propio esquema y su propio rol, sin tocar el código de producción.

## Garantías

- **PROD no cambia.** `CONTRACTS_BUILD_ENV` vale `production` por defecto. En ese caso el Dockerfile compila el código tal cual está en el repositorio y no ejecuta ninguna transformación. El checkout nunca se modifica: la renombración solo corre sobre una copia dentro del builder de Docker.
- **DEV no puede nombrar objetos de PROD.** La renombración cambia, por palabra completa, `yzy_contracts` por `yzy_contracts_dev` (esquema, ledger `_sqlx_migrations` y el ajuste `yzy_contracts_dev.superadmin_id`) y `yzy_contracts_app` por `yzy_contracts_dev_app` (rol). Después de renombrar, el build falla si queda cualquier nombre de PROD (`transform-dev-schema.sh` comprueba `\byzy_contracts(_app)?\b`).
- **La copia de datos se anonimiza en la consulta de origen.** Solo los valores sintéticos llegan al servidor DEV.

## Build

```bash
# Desde la raíz del repositorio (el contexto debe ser la raíz).
docker build -f services/api/Dockerfile \
  --build-arg CONTRACTS_BUILD_ENV=development \
  -t yzy-contracts-api:dev-<commit> .
```

| Build arg | Valores | Default | Efecto |
|---|---|---|---|
| `CONTRACTS_BUILD_ENV` | `production`, `development` | `production` | `development` renombra esquema y rol en la copia del builder. Cualquier otro valor falla el build. |

No hay ninguna otra variable de build. Las de runtime se listan abajo.

## Transformación (`transform-dev-schema.sh`)

| Comando | Qué hace |
|---|---|
| `apply <raíz>` | Reescribe `services/api/src/**/*.rs` y `supabase/migrations/*.sql` bajo `<raíz>`. Lo usa el Dockerfile sobre `/src`. |
| `bootstrap <archivo>` | Imprime `supabase/local/bootstrap.sql` con la misma renombración, para el host DEV. |

Pruebas: `sh services/api/dev-build/test-transform.sh` (trabaja sobre una copia temporal y comprueba que los conteos de esquema y rol se conservan, que no queda ningún nombre de PROD y que el checkout no cambia).

## Rol, esquema y bootstrap en DEV

| Objeto | Nombre en DEV | Notas |
|---|---|---|
| Esquema | `yzy_contracts_dev` | Creado por el bootstrap y por la migración inicial. |
| Ledger | `yzy_contracts_dev._sqlx_migrations` | Lo crea `migrate`. |
| Rol runtime | `yzy_contracts_dev_app` | `NOLOGIN NOINHERIT` al migrar. El login y la contraseña se fijan fuera de banda. |
| Usuario DEV (propietario) | UUID de tu elección en Auth DEV | Es `CONTRACTS_SUPERADMIN_ID`. Debe existir en `auth.users` antes de cargar la copia, y tener fila en `profiles`. |

Pasos, en orden (el host DEV tiene su propio Supabase; no uses el bootstrap sobre un Supabase compartido sin revisarlo):

1. Crea en Auth DEV el usuario propietario y anota su UUID.
2. Bootstrap, con un rol de propietario de la base DEV:
   ```bash
   sh services/api/dev-build/transform-dev-schema.sh bootstrap supabase/local/bootstrap.sql > /secure/dev-bootstrap.sql
   psql "$DEV_OWNER_URL" -v ON_ERROR_STOP=1 -f /secure/dev-bootstrap.sql
   ```
3. Migraciones, con la imagen DEV:
   ```bash
   docker run --rm --env-file /secure/dev-migrate.env yzy-contracts-api:dev-<commit> migrate
   # dev-migrate.env: MIGRATION_DATABASE_URL=<URL del propietario DEV>
   #                  CONTRACTS_SUPERADMIN_ID=<UUID del propietario DEV>
   ```
4. Rol runtime, fuera de banda. La contraseña viene de tu gestor de secretos, nunca de un archivo del repositorio:
   ```sql
   ALTER ROLE yzy_contracts_dev_app LOGIN PASSWORD :'app_password';
   ```
5. Copia anonimizada (sección siguiente).
6. Runtime: `docker run ... yzy-contracts-api:dev-<commit>` con las variables de abajo. `serve` es el comando por defecto; `worker` usa la misma imagen.

Variables de runtime (las mismas que PROD, con valores DEV):

| Variable | Valor en DEV |
|---|---|
| `DATABASE_URL` | `postgres://yzy_contracts_dev_app:<secreto>@<host-db-dev>:5432/<db>` |
| `MIGRATION_DATABASE_URL` | Solo para `migrate`, con el propietario. |
| `CONTRACTS_SUPERADMIN_ID` | UUID del usuario propietario DEV. |
| `CONTRACTS_SUPERADMIN_EMAIL` | Correo del propietario DEV. |
| `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE` | Del Auth DEV (`iss` exacto). |
| `CORS_ALLOWED_ORIGINS`, `HTTP_BIND_ADDR`, `EXTRACTOR_URL`, `EXTRACTOR_API_TOKEN`, `YZY_NOTIFICATIONS_*`, `CONTRACTS_BILLING_*` | Valores DEV propios. |

Sin almacenamiento de objetos: los bytes de PROD no se copian, así que las descargas de la copia DEV no tienen objeto detrás (ver límites).

## Copia anonimizada

El procedimiento en [ops/deployment/dev/README.md](../../../ops/deployment/dev/README.md) copia la estructura de empresas, clientes y expedientes mediante una consulta de solo lectura. Los identificadores, datos personales, fechas y montos son sintéticos. Los archivos, comprobantes y cuentas de producción quedan fuera.
