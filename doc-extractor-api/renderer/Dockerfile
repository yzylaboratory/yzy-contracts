FROM python:3.12.9-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 renderer \
    && useradd --system --uid 10001 --gid renderer --no-create-home renderer

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HOME=/tmp
WORKDIR /app
COPY --chown=renderer:renderer server.py ./server.py

USER renderer
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=4s --start-period=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"
CMD ["python", "server.py"]
