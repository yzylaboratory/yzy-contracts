# syntax=docker/dockerfile:1.7

FROM ghcr.io/astral-sh/uv:0.6.6 AS uv_bin

FROM python:3.12.9-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_NO_CACHE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    APP_ENV=production \
    APP_HOST=0.0.0.0 \
    APP_PORT=8000 \
    ENABLE_API_DOCS=false \
    DOCLING_ARTIFACTS_PATH=/opt/docling-models \
    HF_HOME=/opt/hf-cache \
    TMPDIR=/tmp \
    XDG_CACHE_HOME=/tmp/cache

# Install runtime OS libraries required by Docling (OpenCV/PDFium) and Tesseract OCR (Spanish + English)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-spa \
        tesseract-ocr-osd \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 appgroup \
    && useradd --system --uid 10001 --gid appgroup --create-home --home-dir /home/appuser appuser

COPY --from=uv_bin /uv /uvx /bin/

WORKDIR /app

# Install locked production dependencies (CPU-only PyTorch wheels on Linux via uv.lock)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project --no-cache \
    && rm -rf /root/.cache

ENV PATH="/app/.venv/bin:${PATH}"

# Pre-download Docling layout, table structure, and RapidOCR models (es, en, latin) at build time
# so container startup on Cloudflare Containers / Hetzner is deterministic and needs no runtime model downloads.
RUN mkdir -p "${DOCLING_ARTIFACTS_PATH}" "${HF_HOME}" \
    && docling-tools models download layout tableformer rapidocr \
        --rapidocr-backend-lang onnxruntime:es \
        --rapidocr-backend-lang onnxruntime:en \
        --rapidocr-backend-lang onnxruntime:latin \
        --rapidocr-backend-lang onnxruntime:ch \
        --output-dir "${DOCLING_ARTIFACTS_PATH}" \
    && rm -rf /root/.cache "${HF_HOME}"/* \
    && chown -R appuser:appgroup "${HF_HOME}" \
    && chmod -R a+rX "${DOCLING_ARTIFACTS_PATH}"

COPY --chown=appuser:appgroup app ./app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import os, urllib.request; port = os.environ.get('APP_PORT', '8000'); urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=3)"

# Use exec form so Uvicorn receives SIGTERM/SIGINT directly from Cloudflare Containers
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header", "--timeout-graceful-shutdown", "25"]
