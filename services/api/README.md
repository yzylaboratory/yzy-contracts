# API de YZY Contracts

API REST en Rust (Axum, SQLx) para gestionar contratos, convertir documentos PDF o DOCX en plantillas editables y guardar el historial de generación por cuenta. El historial conserva el binario de las generaciones en formato original.

## Arquitectura

Monolito modular con un solo binario y tres comandos: `serve`, `worker` y `migrate`. Hay un cuarto, `openapi`, que imprime el contrato HTTP.

```mermaid
flowchart LR
    Portal[Portal Next.js] -->|Bearer JWT| API[serve]
    Portal -->|PUT y GET con URL firmada| R2[(Cloudflare R2)]
    Portal -->|Login| Auth[Supabase Auth]
    API -->|JWKS| Auth
    API -->|SQLx como yzy_contracts_app| DB[(Postgres: yzy_contracts)]
    API -->|URLs firmadas, HEAD| R2
    Worker[worker] -->|Cola con SKIP LOCKED| DB
    Worker -->|X-Internal-API-Key y URL firmada| Extractor[doc-extractor-api]
    Extractor -->|GET con URL firmada| R2
```

| Ruta | Contenido |
| --- | --- |
| `src/modules/` | `auth`, `files`, `contracts`, `conversions`, `templates`, `system` |
| `src/infrastructure/` | Base de datos, R2 y cliente del extractor |
| `src/workers/` | Worker de conversiones y limpieza |
| `../../supabase/migrations/` | Migraciones versionadas, incrustadas en el binario |
| `../../specs/openapi/portal-api.yaml` | Contrato generado desde el código; una prueba detecta si queda desfasado |

`doc-extractor-api/` es un proyecto aparte con su propio responsable. Esta API solo consume su contrato (`POST /internal/v1/extract`).

### Decisiones de diseño

| Tema | Decisión |
| --- | --- |
| Base de datos | Schema `yzy_contracts` en el Supabase compartido. `public` queda reservado y ninguna clave foránea usa `CASCADE`, porque el script de `yzy-infra` aborta si encuentra una. |
| Entornos | Un solo binario para PROD y DEV. `CONTRACTS_DATABASE_SCHEMA` elige el esquema (`yzy_contracts` o `yzy_contracts_dev`) y el rol debe coincidir (`yzy_contracts_app` o `yzy_contracts_dev_app`); si no coincide, el arranque falla. Cada conexión tiene `search_path` solo en su esquema, así que las consultas no llevan calificador y DEV no puede leer PROD. Las migraciones se incrustan una vez; DEV aplica el renombrado a su copia y registra checksums en su propio `_sqlx_migrations`. |
| Autorización | La API se conecta como `yzy_contracts_app`, sin DDL. El portal de negocio requiere una membresía activa. Los contratos privados y el historial se filtran por propietario. Los contratos compartidos requieren membresía en la empresa correspondiente y su edición también exige ser el autor. |
| RLS | Activo en todas las tablas. `anon` y `authenticated` no tienen permisos: el portal solo habla con esta API. |
| JWT | ES256 o RS256 verificados con JWKS. Se rechazan HS256, los tokens `anon` y `service_role`, y la API falla cerrada si no puede obtener las claves. |
| Cuentas | La primera petición autenticada crea el perfil en `yzy_contracts.profiles`. Una cuenta de Contracts borrada recibe 403, aunque su login siga vivo para otros productos. |
| Cola | Trabajos en PostgreSQL con `FOR UPDATE SKIP LOCKED` y arriendo por tiempo. Si un worker muere, otro retoma el trabajo. |
| Reintentos | Backoff exponencial limitado por `CONVERSION_MAX_ATTEMPTS`. Un fallo del servicio se reintenta; un documento dañado falla a la primera. |
| Duplicados | Un índice único parcial permite un solo trabajo activo por contrato. Repetir la petición devuelve el mismo trabajo. |
| Reconvertir | Si ya hay plantilla, responde 409 para no sobrescribir ediciones. |
| Integridad | El Markdown se guarda tal como llega. Si el archivo cambia después de registrarse (ETag distinto), la conversión falla. |
| Borrado | `DELETE` elimina al momento la plantilla y las conversiones y oculta el contrato. El worker borra después el objeto en R2 y la fila, y reintenta si R2 falla. |

## Requisitos previos

- Rust 1.95 o superior.
- Docker, para Postgres, Auth y S3 locales.
- Python 3, solo para los scripts de `scripts/`.

## Variables de entorno

Las variables son obligatorias salvo las marcadas como opcionales. [`.env.example`](../../.env.example) documenta cada una.

| Grupo | Variables |
| --- | --- |
| Servidor | `HTTP_BIND_ADDR`, `CORS_ALLOWED_ORIGINS`, `REQUEST_TIMEOUT_SECS`, `RUST_LOG` |
| Base de datos | `DATABASE_URL`, `DATABASE_MAX_CONNECTIONS`, `MIGRATION_DATABASE_URL` (solo `migrate`) |
| Auth | `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE` |
| Esquema y acceso | `CONTRACTS_DATABASE_SCHEMA` (opcional, por defecto `yzy_contracts`; o `yzy_contracts_dev`), `CONTRACTS_ALLOWED_USER_IDS` (UUID separados por coma). DEV exige la lista y debe incluir al superadministrador. Quien no esté en la lista recibe 403 `ACCESS_NOT_ALLOWED` en cualquier ruta privada, `/me` incluida, antes de crear filas. |
| Superadmin (obligatorio para `serve`) | `CONTRACTS_SUPERADMIN_ID` y `CONTRACTS_SUPERADMIN_EMAIL`, UUID y correo de la misma cuenta confirmada |
| R2 | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_FORCE_PATH_STYLE` |
| Límites | `UPLOAD_MAX_BYTES`, `TEMPLATE_MAX_BYTES`, `PRESIGN_UPLOAD_TTL_SECS`, `PRESIGN_DOWNLOAD_TTL_SECS` |
| Extractor y worker | `EXTRACTOR_URL`, `EXTRACTOR_API_TOKEN`, `EXTRACTOR_TIMEOUT_SECS`, `CONVERSION_MAX_ATTEMPTS`, `WORKER_POLL_INTERVAL_SECS` |
| Renderizador Word a PDF (opcional) | `DOCUMENT_RENDERER_URL`, `DOCUMENT_RENDERER_API_TOKEN` |
| Lectura de documentos con OpenRouter (opcional) | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_TIMEOUT_SECS` |

Configura `CONTRACTS_SUPERADMIN_ID` con el UUID de la cuenta de administración de este entorno. La API exige que el UUID configurado y el correo firmado coincidan con la cuenta confirmada en Auth. Esa cuenta accede al maestro global de clientes y a todas las empresas. Las operaciones conservan la empresa responsable. Para el entorno local, provisiona primero la cuenta confirmada en Auth, agrega su UUID a `.env` y arranca la API.

Configura ambas variables del renderizador o déjalas sin definir. La URL base apunta al servicio privado que recibe el DOCX en `POST /v1/render/pdf` con la cabecera `X-Internal-API-Key`. El proxy autenticado `POST /api/v1/contracts/{id}/render-pdf` convierte una copia DOCX del contrato de la cuenta. `POST /api/v1/generated-documents/{id}/render-pdf` vuelve a renderizar una copia DOCX del historial, incluso si se eliminó el contrato. Ambos aplican `REQUEST_TIMEOUT_SECS` y el menor límite entre 20 MiB y `UPLOAD_MAX_BYTES`.

`POST /api/v1/document-readings` lee fotos o PDF y devuelve JSON tipado. Recibe un multipart con `category` (`dominican_id_card`, `vehicle_registration` o `bill_of_lading`) y de una a cuatro partes `file` (JPEG, PNG, WebP o PDF de hasta 10 MiB). El modelo responde con un JSON Schema estricto. La API valida esa salida, normaliza la cédula al formato `000-0000000-0` y comprueba su dígito verificador, las fechas y los VIN. Lo que no cuadra va en `warnings`. Los archivos no se guardan y OpenRouter solo los enruta a proveedores que no retienen datos (`data_collection: deny`). Configura las tres variables o ninguna; sin ellas la ruta responde 503. Esta ruta usa `OPENROUTER_TIMEOUT_SECS` en lugar de `REQUEST_TIMEOUT_SECS`, porque una lectura tarda entre 10 y 45 segundos.

`PUT /api/v1/generated-documents/{id}/artifact` recibe un multipart con la parte JSON `metadata` y la parte binaria `artifact`. En registros de correo, el binario corresponde al adjunto. `GET` sobre la misma ruta recupera esos bytes con acceso por propietario. El historial conserva las entradas antiguas con `has_artifact: false`.

Configura `SUPABASE_JWKS_URL` con el endpoint de claves de tu proyecto y `SUPABASE_JWT_ISSUER` con el valor exacto de `iss` que emiten sus tokens. Para Supabase, la audiencia habitual es `authenticated`. En producción, apunta el JWKS al Kong interno de la red Docker compartida; si la API consulta el dominio público detrás de Cloudflare, un challenge 403 deja la autenticación en `AUTH_UNAVAILABLE` para todos los usuarios.

## Instalación y ejecución local

Desde la raíz del repositorio:

```bash
cp .env.example .env
```

```bash
python3 scripts/generate_local_auth_key.py
```

Pega la línea que imprime en `.env` y cambia las contraseñas. Arranca Auth con `docker compose up -d auth`, provisiona en ese entorno la cuenta de administración y pon su UUID y correo en `CONTRACTS_SUPERADMIN_ID` y `CONTRACTS_SUPERADMIN_EMAIL`. Luego ejecuta:

```bash
docker compose up -d --build api
```

Levanta Postgres, Auth, S3 local y las migraciones, y deja la API en `http://127.0.0.1:8080`. Para el worker y el extractor:

```bash
docker compose up -d --build worker
```

El extractor solo acepta descargas HTTPS desde hosts públicos, así que rechaza el S3 local. Para convertir documentos en local hay que poner en `.env` las credenciales reales de R2 y `EXTRACTOR_R2_ALLOWED_HOSTS`.

## Base de datos y migraciones

| Paso | Local | Supabase compartido |
| --- | --- | --- |
| Schema y `profiles` | `supabase/local/bootstrap.sql` | Provisiona el esquema y la tabla desde la configuración privada de la infraestructura. |
| Migraciones | `docker compose up migrate` | `yzy-contracts-api migrate` con `MIGRATION_DATABASE_URL` de un rol propietario |
| Rol de la API | Lo activa el servicio `app-role` | `ALTER ROLE yzy_contracts_app LOGIN PASSWORD '...'`; la contraseña nunca va en una migración |

```bash
MIGRATION_DATABASE_URL='postgres://...' cargo run -- migrate
```

Al migrar una instalación con documentos históricos, define también `CONTRACTS_SUPERADMIN_ID` para dar prioridad a los enlaces existentes de esa cuenta si hay identificadores duplicados.

Las migraciones nunca corren al arrancar la API, porque su rol no tiene permisos de DDL. El registro de versiones vive en `yzy_contracts._sqlx_migrations`.

La migración al maestro global agrupa fichas existentes cuya identificación coincide al ignorar espacios, guiones y mayúsculas. Conserva el ID más antiguo, toma el último valor disponible por campo y mantiene los otros IDs como alias. El propietario de la base puede consultar las fichas consolidadas originales en `yzy_contracts.client_merge_archive`. Las fichas sin identificación siguen independientes. Las operaciones, los eventos de historial y los archivos generados conservan sus vínculos. Aplica la migración y actualiza API y portal en la misma ventana porque cambian las rutas de clientes.

El historial de documentos de empresa incluye archivos de autores anteriores. Si varias cuentas usaron el mismo ID de documento, la migración conserva la URL del superadministrador cuando existe y reasigna los demás IDs del grupo.

## Swagger

| Ruta | Contenido |
| --- | --- |
| `/swagger-ui` | Interfaz interactiva; usa el botón Authorize con el access token |
| `/api-docs/openapi.json` | Documento OpenAPI |

Tras cambiar un endpoint, regenera el contrato desde `services/api/`:

```bash
cargo run -- openapi > ../../specs/openapi/portal-api.yaml
```

## Docker

La imagen se construye desde la raíz, porque incrusta las migraciones. El mismo binario sirve para los tres comandos:

```bash
docker build -f services/api/Dockerfile -t yzy-contracts-api .
```

```bash
docker run --env-file .env yzy-contracts-api worker
```

## Pruebas

Las pruebas de integración usan un Postgres real y crean una base de datos por prueba. Los mocks (almacenamiento en memoria, JWKS y extractor con wiremock) solo existen bajo `tests/`.

```bash
docker run -d --name yzy-contracts-test-db -e POSTGRES_PASSWORD=test-only-password -p 127.0.0.1:54329:5432 supabase/postgres:17.6.1.136
```

Desde `services/api/`:

```bash
TEST_DATABASE_URL='postgres://postgres:test-only-password@127.0.0.1:54329/postgres' cargo test
```

```bash
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo build
```

Para recorrer los criterios de aceptación contra una pila en marcha (usuarios y documentos sintéticos; se niega a correr contra un Auth no local):

```bash
python3 scripts/e2e_local.py
```

## Flujo de carga y conversión

```mermaid
sequenceDiagram
    participant P as Portal
    participant A as API
    participant R as R2
    participant W as Worker
    participant E as doc-extractor-api
    P->>A: POST /files/upload-url
    A-->>P: upload_id, URL firmada, headers
    P->>R: PUT archivo con esos headers
    P->>A: POST /contracts (upload_id, name)
    A->>R: HEAD y lectura de la firma del archivo
    A-->>P: 201 contrato
    P->>A: POST /contracts/{id}/convert
    A-->>P: 202 trabajo pending
    W->>A: Reclama el trabajo en Postgres
    W->>E: POST /internal/v1/extract
    E->>R: GET con URL firmada
    E-->>W: Markdown y avisos
    W->>W: Guarda plantilla y completa el trabajo
    P->>A: GET /conversions/{id}
    A-->>P: completed, template_id
    P->>A: GET y PUT /templates/{id}
```

Ejemplos, con `TOKEN` como access token de Supabase:

```bash
curl -s http://127.0.0.1:8080/api/v1/health
```

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/files/upload-url -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"file_name":"contrato.pdf","mime_type":"application/pdf","size_bytes":245760}'
```

```bash
curl -s -X PUT "$UPLOAD_URL" -H 'Content-Type: application/pdf' --data-binary @contrato.pdf
```

```bash
curl -s -X POST http://127.0.0.1:8080/api/v1/contracts -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"upload_id\":\"$UPLOAD_ID\",\"name\":\"Contrato de ejemplo\"}"
```

```bash
curl -s -X POST "http://127.0.0.1:8080/api/v1/contracts/$CONTRACT_ID/convert" -H "Authorization: Bearer $TOKEN"
```

```bash
curl -s "http://127.0.0.1:8080/api/v1/conversions/$JOB_ID" -H "Authorization: Bearer $TOKEN"
```

```bash
curl -s -X PUT "http://127.0.0.1:8080/api/v1/templates/$TEMPLATE_ID" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Plantilla","content_markdown":"# Contrato"}'
```

### Endpoint añadido a la lista acordada

`GET /api/v1/contracts/{id}/download-url`: el requisito de descargas temporales autorizadas necesita una ruta propia.

### R2

- El bucket debe ser privado.
- Para que el navegador suba directo, configura CORS en el bucket: el origen del portal, `PUT` y `GET`, y el header `content-type`. El header `content-length` lo pone el navegador.
- La URL firmada incluye `content-type` y `content-length`, de modo que hay que subir exactamente el tipo y tamaño declarados.

## Despliegue

Usa la [plantilla de Compose](../../ops/deployment/README.md) con los nombres de red, dominios y credenciales de tu entorno. Configura la API y el worker con un rol de base de datos sin permisos DDL. Mantén el bucket privado, con credenciales limitadas a ese bucket, y el extractor y el renderer en redes privadas.

## Alternativa: Cloudflare Containers

Esta configuración no se ha desplegado. Sigue la [documentación de Containers](https://developers.cloudflare.com/containers/), todavía en beta, donde cada contenedor se accede desde un Worker con un Durable Object.

| Servicio | Instancia sugerida | Nota |
| --- | --- | --- |
| API (`serve`) | `basic` o `standard-1` | Recibe tráfico por el Worker. |
| Worker (`worker`) | `basic` | Debe seguir corriendo aunque no reciba peticiones. |
| `doc-extractor-api` | `standard-2` o mayor | Docling consume mucha memoria; decide su responsable. |

```jsonc
// wrangler.jsonc de la API; ajusta compatibility_date al desplegar.
{
  "name": "yzy-contracts-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-08",
  "containers": [
    { "class_name": "ContractsApi", "image": "./services/api/Dockerfile", "image_build_context": ".", "instance_type": "standard-1", "max_instances": 3 }
  ],
  "durable_objects": { "bindings": [{ "name": "CONTRACTS_API", "class_name": "ContractsApi" }] },
  "exports": { "ContractsApi": { "type": "durable-object", "storage": "sqlite" } }
}
```

Bloqueos que habría que resolver antes de desplegar ahí:

1. **Conexión a Postgres.** El contenedor necesita una ruta privada o un proxy TCP autenticado hacia la base de datos.
2. **El worker se duerme.** Los contenedores se apagan sin tráfico y su disco es efímero. Los trabajos no se pierden, porque están en Postgres, pero no avanzan hasta que algo lo despierte. Hace falta un disparador periódico.
3. **Comunicación con el extractor.** El contenedor no tiene una dirección interna directa; hay que definir cómo llega el worker hasta él.

## Limitaciones conocidas

- Una plantilla por contrato. Para reconvertir hay que borrar el contrato y subirlo de nuevo.
- Sin control de concurrencia en `PUT /templates/{id}`: gana la última escritura.
- El extractor rechaza HTTP y hosts privados, por lo que en local no convierte con el S3 local.
- El worker procesa un documento a la vez por proceso. Para más capacidad, se levantan más procesos.
- El límite de tamaño lo declara el cliente, se firma en la URL y se verifica al registrar el contrato. El ETag se valida antes de convertir, no al descargar.
- Si un usuario se inscribe en Contracts, su login no se podrá borrar de `auth.users` mientras exista su perfil. Es una decisión del script de `yzy-infra` (`ON DELETE RESTRICT` con perfil permanente).
- No hay limitación de frecuencia por usuario.

### Facturación por transferencia

Como superadministrador, guarda el banco, titular, tipo y número en
**Administración → Facturación → Cuenta bancaria** antes de crear una cuenta de
facturación. Los responsables autorizados ven el destino guardado al volver a
cargar Facturación. El cambio se aplica sin reiniciar la API y conserva las
facturas y transferencias reportadas.

Hasta el primer guardado en el portal, la API usa como respaldo las variables de
servidor `CONTRACTS_BILLING_BANK_NAME`, `CONTRACTS_BILLING_ACCOUNT_HOLDER`,
`CONTRACTS_BILLING_ACCOUNT_TYPE` y `CONTRACTS_BILLING_ACCOUNT_NUMBER` si están
configuradas las cuatro.

En **Administración → Usuarios**, marca uno o varios responsables de facturación.
Cada persona marcada administra todas las cuentas de facturación activas. En
**Administración → Facturación** puedes fijar el responsable principal de cada
cuenta y las empresas que pagan. La cuenta consolida RD$2,000 mensuales por
empresa asignada. Las cuentas nuevas comienzan el primer día del mes siguiente,
salvo que indiques otro primer día. Las altas y bajas de empresas en cuentas
existentes aplican desde el mes siguiente. Guardar una cuenta sin empresas
detiene futuros cobros y conserva las facturas previas. Si archivas una empresa,
retírala también de su cuenta de facturación para detener los próximos cobros.

La factura vence al terminar el primer día del mes, hora de Santo Domingo.
Desde el segundo día, las facturas impagas bloquean nuevas generaciones de las
empresas incluidas. La persona responsable reporta la referencia del depósito
y un administrador confirma o rechaza el reporte. Confirmar todos los cobros
vencidos de una empresa habilita de nuevo la generación. Las descargas del
historial se mantienen disponibles.
