from __future__ import annotations

from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_extraction_service, require_internal_api_key
from app.core.logging import job_id_ctx
from app.schemas.errors import ErrorResponse
from app.schemas.extraction import ExtractionRequest, ExtractionResponse
from app.services.extraction_service import ExtractionService

router = APIRouter(
    prefix="/internal/v1",
    tags=["Extraction"],
    dependencies=[Depends(require_internal_api_key)],
)


@router.post(
    "/extract",
    response_model=ExtractionResponse,
    status_code=HTTPStatus.OK,
    summary="Extract structured Markdown from a PDF or DOCX stored in Cloudflare R2",
    description=(
        "Synchronously downloads a contract document from a presigned Cloudflare R2 HTTPS URL, "
        "validates its format and integrity, converts it to structured Markdown via Docling "
        "(applying OCR when configured), and returns Markdown, metadata, and warnings."
    ),
    responses={
        HTTPStatus.BAD_REQUEST: {
            "model": ErrorResponse,
            "description": (
                "Invalid request payload or forbidden download URL "
                "(`FORBIDDEN_DOWNLOAD_URL`, `INVALID_REQUEST`)."
            ),
        },
        HTTPStatus.UNAUTHORIZED: {
            "model": ErrorResponse,
            "description": "Missing or invalid `X-Internal-API-Key` header (`UNAUTHORIZED`).",
        },
        HTTPStatus.FORBIDDEN: {
            "model": ErrorResponse,
            "description": "Storage denied access to the presigned URL (`STORAGE_ACCESS_DENIED`).",
        },
        HTTPStatus.NOT_FOUND: {
            "model": ErrorResponse,
            "description": "Document was not found in Cloudflare R2 (`DOCUMENT_NOT_FOUND`).",
        },
        HTTPStatus.GONE: {
            "model": ErrorResponse,
            "description": "Presigned download URL has expired (`PRESIGNED_URL_EXPIRED`).",
        },
        HTTPStatus.REQUEST_ENTITY_TOO_LARGE: {
            "model": ErrorResponse,
            "description": "Document exceeds `MAX_FILE_SIZE_MB` (`DOCUMENT_TOO_LARGE`).",
        },
        HTTPStatus.UNPROCESSABLE_ENTITY: {
            "model": ErrorResponse,
            "description": (
                "Unsupported format, empty document, corrupt document, password-protected file, "
                "empty extraction, or Docling conversion failure (`UNSUPPORTED_DOCUMENT_FORMAT`, "
                "`EMPTY_DOCUMENT`, `CORRUPT_DOCUMENT`, `PASSWORD_PROTECTED_DOCUMENT`, "
                "`EMPTY_EXTRACTION`, `CONVERSION_FAILED`)."
            ),
        },
        HTTPStatus.TOO_MANY_REQUESTS: {
            "model": ErrorResponse,
            "description": "Maximum concurrent extractions reached (`TOO_MANY_CONCURRENT_EXTRACTIONS`).",
        },
        HTTPStatus.BAD_GATEWAY: {
            "model": ErrorResponse,
            "description": "Upstream storage failure during download (`DOWNLOAD_FAILED`).",
        },
        HTTPStatus.GATEWAY_TIMEOUT: {
            "model": ErrorResponse,
            "description": "Download or Docling conversion timed out (`DOWNLOAD_TIMEOUT`, `EXTRACTION_TIMEOUT`).",
        },
        HTTPStatus.INTERNAL_SERVER_ERROR: {
            "model": ErrorResponse,
            "description": "Unexpected internal error (`INTERNAL_SERVER_ERROR`).",
        },
    },
)
async def extract_document(
    payload: ExtractionRequest,
    extraction_service: Annotated[ExtractionService, Depends(get_extraction_service)],
) -> ExtractionResponse:
    token = job_id_ctx.set(str(payload.job_id))
    try:
        return await extraction_service.extract(payload)
    finally:
        job_id_ctx.reset(token)
