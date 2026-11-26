# YZY Contracts

- Trabaja dentro del directorio correspondiente a la tarea. El portal está en `apps/portal/`, la API Rust en `services/api/` y el extractor interno en `doc-extractor-api/`.
- Lee `apps/portal/AGENTS.md` cuando cambies el portal Next.js. Conserva Arc UI como base de sus componentes.
- En todas las pantallas y secciones del portal, muestra un esqueleto de Arc que anticipe la estructura del contenido mientras carga. Usa `PortalLoading` para la carga de rutas y `LoadingContent` para bloques asíncronos. Anuncia la carga a lectores de pantalla con texto visualmente oculto.
- Coordina cualquier contrato HTTP entre portal y API en `specs/openapi/`.
- Usa datos sintéticos en fixtures, pruebas y ejemplos. Los directorios locales de expedientes quedan fuera del código versionado.
- Al terminar un cambio solicitado, despliega en producción los servicios afectados y verifica el resultado antes de darlo por terminado, salvo que el usuario indique lo contrario.
- «Avísame cuando esté en DEV» quiere decir que el cambio pase primero por DEV, y eso ya lo hace el pipeline: cada push a `main` publica en DEV y producción espera aprobación. No escondas funciones en producción con código (condiciones por esquema o por dominio, menús filtrados por entorno) salvo que el usuario pida expresamente que algo no llegue a producción.
- Antes de aprobar un despliegue a producción, revisa si algo del cambio quedará oculto o inactivo allí y avísalo antes de aprobar, no como nota al final del reporte.
- Antes de editar a mano, usa herramientas que cambien el código sin pasar por el modelo:
  - Reescrituras estructurales en muchos archivos (firma de una función y todas sus llamadas): `ast-grep run -p '<patrón>' -r '<reemplazo>' -l rust|ts -U <ruta>`. Revisa primero sin `-U`.
  - Arreglos automáticos de lint y compilador: `pnpm fix` (portal con `eslint --fix` y API con `cargo clippy --fix` + `cargo fmt`), o por separado `pnpm lint:fix` y `pnpm fix:api`.

## Production deploys

Deploy only by pushing to `main` (or running the "Deploy production" workflow). GitHub Actions builds commit-tagged images and runs the locked deploy script on Hetzner; deploys queue one at a time. Never build images on the server, rsync working trees, edit the server `compose.yaml`/`.env`, or apply SQL by hand. Details: `ops/deployment/README.md`.

Every deploy emails admin@yzylabs.com through YZY Notifications with the commits it ships. Write each commit body as `- ` bullets in Spanish saying what changed for the user (they are copied into that email), for example:

```
Elegir Word o PDF al generar el expediente

- El botón "Confirmar" abre el panel para elegir el formato (`formatSheetRef`).
- La solicitud de préstamo se descarga en Word (`download_docx`).
- Nuevo campo de seguro pagado (`insurance_paid`).
```
