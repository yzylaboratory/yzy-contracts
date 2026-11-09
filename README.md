# YZY Contracts

Portal de contratos y generación de documentos. El portal de Next.js y Arc UI incluye el login y el dashboard de demostración.

## Estructura

| Ruta | Responsabilidad |
| --- | --- |
| `apps/portal/` | Portal Next.js y componentes de Arc UI. |
| `services/api/` | Espacio reservado para la API Rust. |
| `services/docs-extractor/` | Espacio reservado para el extractor interno FastAPI. |
| `supabase/migrations/` | Futuras migraciones y políticas de acceso de Postgres. |
| `specs/openapi/` | Contratos HTTP que se acuerden entre portal y API. |
| `fixtures/` | Ejemplos sintéticos compartidos. |
| `docs/design/` | Prototipo HTML de referencia. |

## Portal local

Desde la raíz del repositorio:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Abre `http://localhost:3000/login`. Usa `pnpm lint`, `pnpm typecheck` y `pnpm build` desde la raíz.

## Trabajo en paralelo

La rama `feat/portal-ui` corresponde al portal y `feat/api-core` al backend. Trabaja en un worktree por rama. El archivo [CLAUDE.md](CLAUDE.md) describe el traspaso para empezar el backend.

Mantén los expedientes reales en los directorios locales excluidos de Git. Usa únicamente material sintético en fixtures y pruebas.
