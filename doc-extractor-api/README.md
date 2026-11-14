# Doc Extractor API (`doc-extractor-api`)

Internal FastAPI microservice that downloads PDF and DOCX contract files from presigned Cloudflare R2 URLs, validates their integrity, converts them to clean structured Markdown using **Docling**, and returns extraction metadata and warnings to the main Rust API (Axum).

---

## 1. Descripción del microservicio

`doc-extractor-api` tiene una única responsabilidad dentro de la plataforma **YZY Contracts**: **convertir documentos PDF (digitales o escaneados) y DOCX en representaciones Markdown estructuradas y editables**, preservando cláusulas legales, numeración, tablas, listas y caracteres en español.

No gestiona usuarios, sesiones, contratos, colas asíncronas ni base de datos propia; todas esas responsabilidades residen en la API principal en Rust y Supabase PostgreSQL.

---

## 2. Arquitectura

```text
Next.js Portal
      │
      ▼
Rust API (Axum + Worker)
      │  POST /internal/v1/extract
      │  Header: X-Internal-API-Key: <secret>
      ▼
Doc Extractor API (FastAPI)
      ├── 1. Valida X-Internal-API-Key (comparación en tiempo constante)
      ├── 2. Valida URL de R2 (HTTPS, allowlist de hosts, anti-SSRF DNS, sin redirects)
      ├── 3. Descarga en streaming a directorio temporal aislado (0700)
      ├── 4. Valida magic bytes, cifrado/contraseña, estructura PDF/ZIP y límites
      ├── 5. Ejecuta Docling (PDF layout + TableFormer + RapidOCR/Tesseract / Word XML)
      ├── 6. Normaliza Markdown sin alterar cláusulas, montos ni fechas
      ├── 7. Elimina archivos temporales garantizando limpieza en finally
      └── 8. Devuelve JSON tipado (markdown + metadata + warnings)
```

### Estructura del proyecto

```text
doc-extractor-api/
├── app/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── security.py
│   │   ├── exceptions.py
│   │   └── logging.py
│   ├── api/
│   │   ├── dependencies.py
│   │   └── routes/
│   │       ├── health.py
│   │       └── extraction.py
│   ├── schemas/
│   │   ├── extraction.py
│   │   └── errors.py
│   ├── services/
│   │   ├── document_downloader.py
│   │   ├── document_validator.py
│   │   ├── document_converter.py
│   │   └── extraction_service.py
│   └── utils/
│       └── temporary_files.py
├── examples/
│   └── rust_client.rs
├── tests/
│   ├── fixtures/
│   │   ├── document_builders.py
│   │   └── files/
│   ├── unit/
│   │   └── test_unit_suite.py
│   └── integration/
│       └── test_extraction_integration.py
├── Dockerfile
├── .dockerignore
├── .env.example
├── openapi.json
├── pyproject.toml
├── uv.lock
└── README.md
```

---

## 3. Stack tecnológico

| Componente | Tecnología | Versión |
|---|---|---|
| Lenguaje | Python | 3.12 (`>=3.12,<3.14`) |
| Framework HTTP | FastAPI | `>=0.115.0` (0.162.x en `uv.lock`) |
| Servidor ASGI | Uvicorn (`standard`) | `>=0.34.0` |
| Conversión documental | Docling (`docling`, `docling-core`, `docling-parse`) | `2.149.0` |
| Motor OCR principal | RapidOCR (`rapidocr` + `onnxruntime` PP-OCRv6) / Tesseract CLI | `3.10.0` / `1.4.4` |
| Validación de documentos | `pypdf` + `python-docx` + `zipfile` | `7.0.0` / `1.2.0` |
| Validación y configuración | Pydantic v2 + `pydantic-settings` | `2.14.x` / `2.16.x` |
| Cliente HTTP | `httpx` | `0.28.1` |
| Gestión de paquetes | `uv` | Lockfile reproducible (`uv.lock`) |
| Calidad y pruebas | `ruff`, `pytest`, `pytest-asyncio` | `0.17.x`, `9.2.x` |

---

## 4. Requisitos

- **Python**: `3.12`
- **Gestor de entornos**: [`uv`](https://docs.astral.sh/uv/)
- **Dependencias del sistema (Linux / Docker)**:
  - `libgl1`, `libglib2.0-0`, `libgomp1` (requeridos por OpenCV / PDFium / ONNXRuntime).
  - Opcional para `OCR_ENGINE=tesseract`: `tesseract-ocr`, `tesseract-ocr-spa`, `tesseract-ocr-eng`, `tesseract-ocr-osd`.

---

## 5. Instalación

```bash
cd doc-extractor-api
uv sync --python 3.12 --frozen
```

---

## 6. Variables de entorno

Copia `.env.example` a `.env` y ajusta los valores:

```bash
cp .env.example .env
```

| Variable | Por defecto | Descripción |
|---|---|---|
| `APP_NAME` | `Doc Extractor API` | Nombre del servicio en OpenAPI. |
| `APP_ENV` | `development` | `development`, `staging`, `production` o `test`. |
| `APP_HOST` | `0.0.0.0` | Host de escucha para Uvicorn. |
| `APP_PORT` | `8000` | Puerto HTTP del servicio. |
| `INTERNAL_API_KEY` | *(requerido)* | Clave secreta compartida con la API Rust (`X-Internal-API-Key`). |
| `MAX_FILE_SIZE_MB` | `25` | Tamaño máximo permitido por documento (1–200 MB). |
| `MAX_CONCURRENT_EXTRACTIONS` | `2` | Límite de conversiones simultáneas por instancia. |
| `DOWNLOAD_CONNECT_TIMEOUT_SECONDS` | `10` | Timeout de conexión hacia Cloudflare R2 (segundos). |
| `DOWNLOAD_TIMEOUT_SECONDS` | `60` | Timeout de lectura durante la descarga desde R2 (segundos). |
| `EXTRACTION_TIMEOUT_SECONDS` | `300` | Timeout máximo de conversión en Docling (segundos). |
| `OCR_ENABLED` | `true` | Habilita o deshabilita globalmente el soporte OCR. |
| `OCR_LANGUAGES` | `es,en` | Idiomas permitidos para OCR (`es`, `en`). |
| `OCR_ENGINE` | `auto` | Motor OCR: `auto` / `rapidocr` (ONNXRuntime PP-OCRv6) o `tesseract`. |
| `R2_ALLOWED_HOSTS` | *(requerido)* | Lista separada por comas de hosts HTTPS de R2 autorizados (ej. `<account_id>.r2.cloudflarestorage.com`). |
| `DOCLING_ARTIFACTS_PATH` | `None` | Ruta local a modelos predescargados (en Docker: `/opt/docling-models`). |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`. |
| `ENABLE_API_DOCS` | `true` | Publica `/docs`, `/redoc` y `/openapi.json` (`false` en producción). |

---

## 7. Ejecución local

```bash
cd doc-extractor-api
export INTERNAL_API_KEY="local-dev-secret"
export R2_ALLOWED_HOSTS="example.r2.cloudflarestorage.com"
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Endpoints de salud:
- `GET http://localhost:8000/health`
- `GET http://localhost:8000/ready`

---

## 8. Docker

La imagen de producción utiliza `python:3.12.9-slim-bookworm`, instala únicamente PyTorch CPU + dependencias bloqueadas con `uv`, **pre-descarga los modelos de Docling (`layout`, `tableformer`, `rapidocr`) durante el `docker build`** en `/opt/docling-models`, y ejecuta el proceso bajo el usuario sin privilegios `appuser` (`UID 10001`).

```bash
cd doc-extractor-api
docker build -t doc-extractor-api:latest .

docker run --rm -p 8000:8000 \
  -e INTERNAL_API_KEY="local-dev-secret" \
  -e R2_ALLOWED_HOSTS="example.r2.cloudflarestorage.com" \
  -e ENABLE_API_DOCS="false" \
  doc-extractor-api:latest
```

---

## 9. Swagger y OpenAPI

Cuando `ENABLE_API_DOCS=true`:
- **Swagger UI**: `http://localhost:8000/docs` (incluye el botón **Authorize** para ingresar `X-Internal-API-Key`).
- **ReDoc**: `http://localhost:8000/redoc`
- **OpenAPI JSON**: `http://localhost:8000/openapi.json` y archivo versionado en [`openapi.json`](./openapi.json).

En producción (`ENABLE_API_DOCS=false`), las tres rutas quedan deshabilitadas y devuelven `404`.

---

## 10. Ejemplo de extracción y prueba con URL prefirmada real de R2

### Cómo generar una URL prefirmada válida de Cloudflare R2

Para probar una conversión real contra un bucket de Cloudflare R2 (cuyo host esté incluido en `R2_ALLOWED_HOSTS`, por ejemplo `<account_id>.r2.cloudflarestorage.com`):

```bash
# Usando AWS CLI configurado con credenciales de Cloudflare R2:
export AWS_ACCESS_KEY_ID="<r2_access_key_id>"
export AWS_SECRET_ACCESS_KEY="<r2_secret_access_key>"
export AWS_DEFAULT_REGION="auto"
export R2_ENDPOINT="https://<account_id>.r2.cloudflarestorage.com"

# 1. Subir un PDF sintético de prueba al bucket
aws --endpoint-url "${R2_ENDPOINT}" s3 cp \
  tests/fixtures/files/contrato_digital.pdf \
  s3://contracts/test/contrato.pdf

# 2. Generar la URL prefirmada HTTPS temporal (válida por 300 segundos)
PRESIGNED_R2_URL=$(aws --endpoint-url "${R2_ENDPOINT}" s3 presign \
  s3://contracts/test/contrato.pdf --expires-in 300)
```

### Petición con `curl`

```bash
curl -X POST http://localhost:8000/internal/v1/extract \
  -H "Content-Type: application/json" \
  -H "X-Internal-API-Key: local-dev-secret" \
  -d '{
    "job_id": "ae17c335-55bc-401a-a46a-391dc7b54d8b",
    "document": {
      "filename": "contrato.pdf",
      "content_type": "application/pdf",
      "download_url": "PRESIGNED_R2_URL"
    },
    "options": {
      "ocr_mode": "auto",
      "ocr_languages": ["es", "en"],
      "extract_tables": true
    }
  }'
```

### Respuesta exitosa (`200 OK`)

```json
{
  "job_id": "ae17c335-55bc-401a-a46a-391dc7b54d8b",
  "status": "completed",
  "document": {
    "filename": "contrato.pdf",
    "content_type": "application/pdf",
    "page_count": 1
  },
  "extraction": {
    "markdown": "# CONTRATO DE SERVICIOS PROFESIONALES\n\n## PRIMERA: OBJETO DEL CONTRATO\n\nEl contratista se compromete a prestar los servicios de consultoría tecnológica en Santo Domingo, República Dominicana, con ética y diligencia.\n\n## SEGUNDA: OBLIGACIONES Y LISTADO\n\n1. Entregar informes técnicos mensuales.\n2. Garantizar confidencialidad sobre la información.\n3. Cumplir los niveles de servicio acordados.\n\n## TERCERA: MONTO Y FORMA DE PAGO\n\nEl monto total acordado es RD$50,000.00 pagaderos según el siguiente desglose:\n\n| Hito   | Descripción          | Monto        |\n|--------|----------------------|--------------|\n| Fase 1 | Diagnóstico inicial  | RD$20,000.00 |\n| Fase 2 | Implementación final | RD$30,000.00 |",
    "metadata": {
      "tables_detected": 1,
      "ocr_used": false,
      "duration_ms": 1420
    },
    "warnings": []
  }
}
```

### Códigos de error deterministas

Todas las respuestas de error mantienen la estructura:

```json
{
  "error": {
    "code": "UNSUPPORTED_DOCUMENT_FORMAT",
    "message": "Only PDF and DOCX files are supported."
  }
}
```

| Código | HTTP Status | Cuándo ocurre |
|---|---|---|
| `UNAUTHORIZED` | `401` | Falta `X-Internal-API-Key` o no coincide. |
| `FORBIDDEN_DOWNLOAD_URL` | `400` | Esquema distinto de HTTPS, host fuera de `R2_ALLOWED_HOSTS`, IP privada/loopback (anti-SSRF) o redirección HTTP. |
| `STORAGE_ACCESS_DENIED` | `403` | R2 denegó el acceso a la firma (`403` no expirado). |
| `DOCUMENT_NOT_FOUND` | `404` | El objeto no existe en Cloudflare R2 (`404`). |
| `PRESIGNED_URL_EXPIRED` | `410` | La URL prefirmada expiró (`X-Amz-Expires` vencido o respuesta R2 `Request has expired`). |
| `DOCUMENT_TOO_LARGE` | `413` | El archivo supera `MAX_FILE_SIZE_MB` (por `Content-Length` o durante el streaming). |
| `UNSUPPORTED_DOCUMENT_FORMAT` | `422` | Formato distinto de PDF/DOCX o discrepancia entre extensión y `content_type`. |
| `EMPTY_DOCUMENT` | `422` | Archivo de 0 bytes. |
| `CORRUPT_DOCUMENT` | `422` | PDF/DOCX truncado, corrupto, sin `word/document.xml` o que excede límites de descompresión. |
| `PASSWORD_PROTECTED_DOCUMENT` | `422` | PDF o contenedor Office cifrado con contraseña. |
| `EMPTY_EXTRACTION` | `422` | El documento no produjo texto extraíble tras la conversión. |
| `CONVERSION_FAILED` | `422` | Fallo interno de Docling al procesar la estructura del documento. |
| `INVALID_REQUEST` | `422` | Error de validación de esquema Pydantic en el request. |
| `TOO_MANY_CONCURRENT_EXTRACTIONS` | `429` | Se alcanzó `MAX_CONCURRENT_EXTRACTIONS` en la instancia. |
| `DOWNLOAD_FAILED` | `502` | Corte de red o error `5xx` al descargar desde R2. |
| `DOWNLOAD_TIMEOUT` | `504` | Se superó `DOWNLOAD_TIMEOUT_SECONDS`. |
| `EXTRACTION_TIMEOUT` | `504` | Se superó `EXTRACTION_TIMEOUT_SECONDS`. |
| `INTERNAL_SERVER_ERROR` | `500` | Error inesperado del servidor (sin exponer stack traces). |

---

## 11. Integración con Rust

Consulta el cliente de referencia completo en [`examples/rust_client.rs`](./examples/rust_client.rs), que muestra cómo:
1. Enviar `POST /internal/v1/extract` con `X-Internal-API-Key` y `X-Request-Id`.
2. Deserializar `ExtractionResponse` o `ErrorEnvelope`.
3. Clasificar errores en `Transient` (`429`, `502`, `503`, `504`) vs `Permanent` (`400`, `404`, `410`, `413`, `422`) para el worker de la cola en PostgreSQL.

---

## 12. Pruebas

Ejecutar linter y suite completa de pruebas unitarias e integración (incluyendo conversiones reales con Docling sobre PDF digital, PDF escaneado con OCR y DOCX con tablas y listas en español):

```bash
cd doc-extractor-api
uv run ruff check .
uv run pytest -v
```

---

## 13. Despliegue en Cloudflare Containers

### Restricciones de Cloudflare Containers consideradas

| Tipo de instancia | vCPU | Memoria | Disco efímero | Recomendación para Docling |
|---|---|---|---|---|
| `lite` / `basic` | 1/16 – 1/4 | 256 MiB – 1 GiB | 2 – 4 GB | **Insuficiente** para los modelos de layout, TableFormer y ONNXRuntime. |
| `standard-2` | 1 vCPU | 6 GiB | 12 GB | **Mínimo recomendado** (`MAX_CONCURRENT_EXTRACTIONS=1`). |
| `standard-3` | 2 vCPU | 8 GiB | 16 GB | **Recomendado en producción** (`MAX_CONCURRENT_EXTRACTIONS=2`). |
| `standard-4` | 4 vCPU | 12 GiB | 20 GB | Alta carga (`MAX_CONCURRENT_EXTRACTIONS=3`). |

### Directrices operativas en Cloudflare Containers

1. **Disco efímero (`/tmp`)**: Cloudflare Containers proporciona almacenamiento local efímero (12–20 GB en `standard-2`/`standard-3`). `temporary_document_path` crea un directorio aislado por petición en `TMPDIR` (`/tmp`) y lo elimina inmediatamente en el bloque `finally`.
2. **Sin descargas de modelos en caliente**: La imagen Docker pre-descarga los artefactos en `/opt/docling-models` durante el build para no consumir ancho de banda ni tiempo de arranque cuando Cloudflare escala una instancia desde cero.
3. **Concurrencia controlada**: Mantén `MAX_CONCURRENT_EXTRACTIONS=1` (en `standard-2`) o `2` (en `standard-3`). Si llegan más peticiones simultáneas, el servicio responde inmediatamente con `429 TOO_MANY_CONCURRENT_EXTRACTIONS` para que el worker de Rust reintente o el balanceador de Cloudflare enrute hacia otra instancia sin provocar un OOM kill.

---

## 14. Limitaciones conocidas

1. **Elementos visuales no textuales**: Firmas manuscritas, sellos húmedos y logotipos incrustados como imágenes no se transcriben a Markdown; cuando se detectan figuras incrustadas, el servicio añade la advertencia `EMBEDDED_FIGURES_OMITTED` en `extraction.warnings`.
2. **Tablas complejas con celdas combinadas**: Markdown estándar (GFM) no soporta `rowspan`/`colspan` nativos; Docling aplana las celdas combinadas en una cuadrícula Markdown legible.
3. **Formatos legados `.doc` (OLE2 binario)**: Por seguridad y determinismo, solo se aceptan `.pdf` y `.docx` (OpenXML). Los archivos `.doc` binarios o contenedores cifrados son rechazados con `422`.
