from __future__ import annotations

import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import __version__
from app.api.routes import extraction, health
from app.core.config import Settings, get_settings
from app.core.exceptions import AppError
from app.core.logging import configure_logging, request_id_ctx
from app.schemas.errors import ErrorDetail, ErrorResponse
from app.services.document_converter import DoclingDocumentConverter
from app.services.document_downloader import DocumentDownloader
from app.services.document_validator import DocumentValidator
from app.services.extraction_service import ExtractionService

logger = logging.getLogger(__name__)

OPENAPI_TAGS = [
    {
        "name": "Health",
        "description": "Liveness (`/health`) and readiness (`/ready`) probes for container orchestrators.",
    },
    {
        "name": "Extraction",
        "description": (
            "Internal document conversion endpoints protected by `X-Internal-API-Key`. "
            "Downloads PDF and DOCX files from presigned Cloudflare R2 URLs and converts "
            "them into structured Markdown via Docling."
        ),
    },
]


def build_default_extraction_service(settings: Settings) -> ExtractionService:
    downloader = DocumentDownloader(settings=settings)
    validator = DocumentValidator(max_file_size_mb=settings.max_file_size_mb)
    converter = DoclingDocumentConverter(settings=settings)
    return ExtractionService(
        settings=settings,
        downloader=downloader,
        validator=validator,
        converter=converter,
    )


def create_app(
    settings: Settings | None = None,
    extraction_service: ExtractionService | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    configure_logging(resolved_settings.log_level)

    @asynccontextmanager
    async def lifespan(app_instance: FastAPI) -> AsyncIterator[None]:
        if getattr(app_instance.state, "settings", None) is None:
            app_instance.state.settings = resolved_settings
        if getattr(app_instance.state, "extraction_service", None) is None:
            app_instance.state.extraction_service = extraction_service or build_default_extraction_service(
                resolved_settings
            )
        logger.info(
            "Doc Extractor API started",
            extra={
                "app_env": resolved_settings.app_env,
                "max_file_size_mb": resolved_settings.max_file_size_mb,
                "max_concurrent_extractions": resolved_settings.max_concurrent_extractions,
                "ocr_enabled": resolved_settings.ocr_enabled,
                "enable_api_docs": resolved_settings.enable_api_docs,
            },
        )
        yield
        logger.info("Doc Extractor API shutting down")

    docs_url = "/docs" if resolved_settings.enable_api_docs else None
    redoc_url = "/redoc" if resolved_settings.enable_api_docs else None
    openapi_url = "/openapi.json" if resolved_settings.enable_api_docs else None

    application = FastAPI(
        title=resolved_settings.app_name,
        version=__version__,
        description=(
            "Internal microservice that downloads PDF and DOCX contract files from presigned "
            "Cloudflare R2 URLs and converts them into clean, structured Markdown using Docling."
        ),
        openapi_tags=OPENAPI_TAGS,
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
        lifespan=lifespan,
    )

    application.state.settings = resolved_settings
    application.state.extraction_service = extraction_service or build_default_extraction_service(resolved_settings)

    @application.middleware("http")
    async def request_correlation_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        incoming_req_id = request.headers.get("x-request-id", "").strip()
        req_id = incoming_req_id if incoming_req_id else str(uuid.uuid4())
        token = request_id_ctx.set(req_id)
        try:
            response = await call_next(request)
            response.headers["X-Request-Id"] = req_id
            return response
        finally:
            request_id_ctx.reset(token)

    @application.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        body = ErrorResponse(error=ErrorDetail(code=exc.code, message=exc.message))
        return JSONResponse(
            status_code=exc.status_code,
            content=body.model_dump(),
        )

    @application.exception_handler(RequestValidationError)
    async def handle_validation_error(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        errors = exc.errors()
        first_msg = "Request payload validation failed."
        if errors:
            loc = ".".join(str(part) for part in errors[0].get("loc", []) if part != "body")
            msg = errors[0].get("msg", "Invalid value")
            first_msg = f"{loc}: {msg}" if loc else str(msg)

        body = ErrorResponse(
            error=ErrorDetail(
                code="INVALID_REQUEST",
                message=first_msg,
            )
        )
        return JSONResponse(
            status_code=HTTPStatus.UNPROCESSABLE_ENTITY,
            content=body.model_dump(),
        )

    @application.exception_handler(Exception)
    async def handle_unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "Unhandled server exception",
            exc_info=exc,
            extra={"error_type": type(exc).__name__},
        )
        body = ErrorResponse(
            error=ErrorDetail(
                code="INTERNAL_SERVER_ERROR",
                message="An unexpected internal server error occurred.",
            )
        )
        return JSONResponse(
            status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
            content=body.model_dump(),
        )

    application.include_router(health.router)
    application.include_router(extraction.router)

    return application


app = create_app()
