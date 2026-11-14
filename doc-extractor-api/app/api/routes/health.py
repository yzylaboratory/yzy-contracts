from __future__ import annotations

from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app import __version__
from app.api.dependencies import get_app_settings
from app.core.config import Settings
from app.schemas.extraction import HealthResponse, ReadinessResponse

router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness probe",
    description="Lightweight liveness probe confirming the HTTP server process is responsive.",
)
async def health_check() -> HealthResponse:
    return HealthResponse(status="ok", service="doc-extractor-api", version=__version__)


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    responses={
        HTTPStatus.SERVICE_UNAVAILABLE: {
            "model": ReadinessResponse,
            "description": "Service is not ready to accept extraction jobs.",
        }
    },
    summary="Readiness probe",
    description=(
        "Verifies that required internal configuration and the document extraction service "
        "are initialized without exposing secrets."
    ),
)
async def readiness_check(
    request: Request,
    settings: Annotated[Settings, Depends(get_app_settings)],
) -> JSONResponse:
    api_key_configured = bool(settings.internal_api_key.get_secret_value().strip())
    r2_hosts_configured = len(settings.r2_allowed_hosts) > 0
    service_initialized = getattr(request.app.state, "extraction_service", None) is not None

    checks = {
        "api_key_configured": api_key_configured,
        "r2_hosts_configured": r2_hosts_configured,
        "converter_ready": service_initialized,
    }
    all_ready = all(checks.values())
    payload = ReadinessResponse(
        status="ready" if all_ready else "not_ready",
        service="doc-extractor-api",
        checks=checks,
    )
    status_code = HTTPStatus.OK if all_ready else HTTPStatus.SERVICE_UNAVAILABLE
    return JSONResponse(status_code=status_code, content=payload.model_dump())
