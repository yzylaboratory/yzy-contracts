from __future__ import annotations

import asyncio
import logging
import time

from app.core.config import Settings
from app.core.exceptions import (
    AppError,
    ConcurrencyLimitError,
    ExtractionTimeoutError,
)
from app.schemas.extraction import (
    DocumentSummary,
    ExtractionMetadata,
    ExtractionRequest,
    ExtractionResponse,
    ExtractionResultPayload,
)
from app.services.document_converter import DocumentConverterPort
from app.services.document_downloader import DocumentDownloader
from app.services.document_validator import DocumentValidator
from app.utils.temporary_files import temporary_document_path

logger = logging.getLogger(__name__)


class ExtractionService:
    """Orchestrates URL validation, streaming download, file validation, and Docling conversion."""

    def __init__(
        self,
        settings: Settings,
        downloader: DocumentDownloader,
        validator: DocumentValidator,
        converter: DocumentConverterPort,
    ) -> None:
        self._settings = settings
        self._downloader = downloader
        self._validator = validator
        self._converter = converter
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_extractions)

    async def extract(self, request: ExtractionRequest) -> ExtractionResponse:
        # 1. Pre-validate declared format before acquiring a worker slot or downloading bytes.
        validated_mime, kind, suffix = self._validator.validate_declared_format(
            filename=request.document.filename,
            content_type=request.document.content_type,
        )

        # 2. Enforce bounded concurrency without queuing indefinitely.
        if self._semaphore.locked():
            logger.warning(
                "Rejected extraction request because concurrency limit is reached",
                extra={
                    "max_concurrent_extractions": self._settings.max_concurrent_extractions,
                    "document_type": validated_mime,
                },
            )
            raise ConcurrencyLimitError()

        async with self._semaphore:
            total_start = time.perf_counter()
            with temporary_document_path(suffix=suffix) as temp_path:
                # 3. Validate URL and stream document to temporary storage.
                download_metrics = await self._downloader.download_to_path(
                    url=request.document.download_url,
                    destination=temp_path,
                )

                # 4. Validate magic bytes, encryption, and structural integrity.
                validated_doc = await asyncio.to_thread(
                    self._validator.validate_downloaded_file,
                    temp_path,
                    request.document.filename,
                    validated_mime,
                )

                # 5. Run CPU-bound Docling conversion in a worker thread with timeout.
                conversion_start = time.perf_counter()
                try:
                    conversion_output = await asyncio.wait_for(
                        asyncio.to_thread(
                            self._converter.convert,
                            validated_doc,
                            request.options,
                        ),
                        timeout=self._settings.extraction_timeout_seconds,
                    )
                except TimeoutError as exc:
                    logger.error(
                        "Docling conversion timed out",
                        extra={
                            "document_type": validated_mime,
                            "size_bytes": download_metrics.size_bytes,
                            "timeout_seconds": self._settings.extraction_timeout_seconds,
                        },
                    )
                    raise ExtractionTimeoutError() from exc
                except AppError as exc:
                    logger.warning(
                        "Document extraction failed with controlled error",
                        extra={
                            "document_type": validated_mime,
                            "size_bytes": download_metrics.size_bytes,
                            "error_code": exc.code,
                        },
                    )
                    raise

                conversion_duration_ms = int((time.perf_counter() - conversion_start) * 1000)
                total_duration_ms = max(1, int((time.perf_counter() - total_start) * 1000))
                warning_codes = [w.code for w in conversion_output.warnings]

                logger.info(
                    "Document extraction completed",
                    extra={
                        "document_type": validated_mime,
                        "document_kind": kind,
                        "size_bytes": download_metrics.size_bytes,
                        "download_duration_ms": download_metrics.duration_ms,
                        "conversion_duration_ms": conversion_duration_ms,
                        "total_duration_ms": total_duration_ms,
                        "page_count": conversion_output.page_count,
                        "tables_detected": conversion_output.tables_detected,
                        "ocr_used": conversion_output.ocr_used,
                        "result": "completed",
                        "warnings": warning_codes,
                    },
                )

                return ExtractionResponse(
                    job_id=request.job_id,
                    status="completed",
                    document=DocumentSummary(
                        filename=request.document.filename,
                        content_type=validated_mime,
                        page_count=conversion_output.page_count,
                    ),
                    extraction=ExtractionResultPayload(
                        markdown=conversion_output.markdown,
                        metadata=ExtractionMetadata(
                            tables_detected=conversion_output.tables_detected,
                            ocr_used=conversion_output.ocr_used,
                            duration_ms=total_duration_ms,
                        ),
                        warnings=conversion_output.warnings,
                    ),
                )
