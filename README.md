# YZY Contracts

Portal de contratos y generación de documentos. El portal de Next.js y Arc UI incluye el login y el dashboard de demostración.

## Estructura

| Ruta | Responsabilidad |
| --- | --- |
| `apps/portal/` | Portal Next.js y componentes de Arc UI. |
| `services/api/` | API Rust y worker de conversiones. Consulta su [README](services/api/README.md). |
| `doc-extractor-api/` | Extractor interno FastAPI con Docling. |
| `supabase/migrations/` | Migraciones y políticas de acceso de Postgres. |
| `supabase/local/` | Preparación de la base de datos local. |
| `specs/openapi/` | Contrato HTTP entre portal y API, generado desde el código. |
| `fixtures/` | Generador de documentos sintéticos. |
| `scripts/` | Clave local de Auth y recorrido de aceptación. |
| `docs/design/` | Prototipo HTML de referencia. |

## Portal local

Desde la raíz del repositorio:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abre `http://localhost:3000/login`. Usa `pnpm lint`, `pnpm typecheck` y `pnpm build` desde la raíz.

## Trabajo en paralelo

El portal, la API y el extractor se desarrollan por separado dentro de este monorepo. Cada área trabaja solo en su directorio y se coordina con las demás mediante sus contratos HTTP.

Mantén los expedientes reales en los directorios locales excluidos de Git. Usa únicamente material sintético en fixtures y pruebas.
