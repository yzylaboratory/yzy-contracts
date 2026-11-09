# Traspaso para Claude Code

Abre Claude Code desde el worktree de `feat/api-core`. Lee [README.md](README.md) y [AGENTS.md](AGENTS.md) para ubicarte.

Tu área de trabajo es `services/api/`. Las futuras migraciones pertenecen a `supabase/migrations/`. Si una decisión afecta al portal, coordínala mediante un contrato en `specs/openapi/`. El portal se desarrolla por separado en `apps/portal/`.

El punto de partida es una API Rust. La primera entrega propuesta cubre salud del servicio, métricas del dashboard y listado paginado de contratos. Confirma con el responsable del proyecto el modelo de acceso y los recursos de desarrollo antes de definir las políticas de acceso o conectar servicios. Usa datos sintéticos para ejemplos y pruebas.
