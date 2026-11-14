from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
job_id_ctx: ContextVar[str | None] = ContextVar("job_id", default=None)

_STANDARD_LOG_ATTRS = {
    "args",
    "asctime",
    "created",
    "exc_info",
    "exc_text",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "module",
    "msecs",
    "message",
    "msg",
    "name",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "stack_info",
    "thread",
    "threadName",
    "taskName",
}

_SENSITIVE_KEYS = {
    "authorization",
    "x-internal-api-key",
    "api_key",
    "internal_api_key",
    "download_url",
    "source_url",
    "markdown",
    "token",
    "secret",
}


def redact_url(url: str) -> str:
    """Return scheme, host, and path without query parameters or credentials."""
    try:
        parts = urlsplit(url)
        if not parts.scheme or not parts.hostname:
            return "<invalid-url>"
        port_suffix = f":{parts.port}" if parts.port else ""
        return f"{parts.scheme}://{parts.hostname}{port_suffix}{parts.path}"
    except Exception:
        return "<redacted-url>"


class StructuredJsonFormatter(logging.Formatter):
    """JSON log formatter that automatically attaches correlation IDs and strips secrets."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        req_id = request_id_ctx.get()
        if req_id:
            payload["request_id"] = req_id
        current_job_id = job_id_ctx.get()
        if current_job_id:
            payload["job_id"] = current_job_id

        for key, value in record.__dict__.items():
            if key in _STANDARD_LOG_ATTRS or key.startswith("_"):
                continue
            if key.lower() in _SENSITIVE_KEYS:
                continue
            payload[key] = value

        if record.exc_info:
            exc_type = record.exc_info[0]
            payload["exception_type"] = exc_type.__name__ if exc_type else "Exception"

        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.setLevel(level.upper())

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredJsonFormatter())

    root.handlers.clear()
    root.addHandler(handler)

    # Prevent third-party libraries from logging full URLs with query tokens at INFO level.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
