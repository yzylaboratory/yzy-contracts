from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request, Security
from fastapi.security import APIKeyHeader

from app.core.config import Settings
from app.core.security import verify_internal_api_key
from app.services.extraction_service import ExtractionService

internal_api_key_header = APIKeyHeader(
    name="X-Internal-API-Key",
    scheme_name="InternalApiKey",
    description="Shared secret header sent by the internal Rust API (`X-Internal-API-Key`).",
    auto_error=False,
)


def get_app_settings(request: Request) -> Settings:
    settings: Settings | None = getattr(request.app.state, "settings", None)
    if settings is None:
        from app.core.config import get_settings

        return get_settings()
    return settings


def require_internal_api_key(
    api_key: Annotated[str | None, Security(internal_api_key_header)],
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> None:
    verify_internal_api_key(api_key, settings)


def get_extraction_service(request: Request) -> ExtractionService:
    service: ExtractionService | None = getattr(request.app.state, "extraction_service", None)
    if service is None:
        raise RuntimeError("ExtractionService has not been initialized on app.state.")
    return service
