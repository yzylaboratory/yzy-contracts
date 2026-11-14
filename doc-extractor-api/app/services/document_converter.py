from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from docling.datamodel.base_models import ConversionStatus, InputFormat
from docling.datamodel.pipeline_options import (
    OcrMode as DoclingOcrMode,
)
from docling.datamodel.pipeline_options import (
    PdfPipelineOptions,
    RapidOcrOptions,
    TesseractCliOcrOptions,
)
from docling.document_converter import DocumentConverter, PdfFormatOption, WordFormatOption

from app.core.config import Settings
from app.core.exceptions import ConversionFailedError, CorruptDocumentError, EmptyExtractionError
from app.schemas.extraction import ExtractionOptions, ExtractionWarningItem
from app.services.document_validator import ValidatedDocument

logger = logging.getLogger(__name__)

_CLAUSE_LINE_RE = re.compile(
    r"^(?:"
    r"(?:CL[ÁA]USULA\s+)?"
    r"(?:PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA|D[ÉE]CIMA"
    r"(?:\s+(?:PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA))?)"
    r"|ART[ÍI]CULO\s+(?:\d+|[IVXLCDM]+)"
    r")\s*[:.\-–—]\s+.+$"
)

_MULTI_BLANK_LINES_RE = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class ConversionOutputData:
    markdown: str
    page_count: int | None
    tables_detected: int
    ocr_used: bool | None
    warnings: list[ExtractionWarningItem]


class DocumentConverterPort(Protocol):
    def convert(
        self,
        document: ValidatedDocument,
        options: ExtractionOptions,
    ) -> ConversionOutputData: ...


def normalize_contract_markdown(raw_markdown: str) -> str:
    """Clean whitespace and promote standalone legal clause lines without altering wording."""
    text = raw_markdown.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]

    normalized_lines: list[str] = []
    has_h1 = any(line.startswith("# ") for line in lines)

    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped == "<!-- image -->":
            continue

        prev_blank = idx == 0 or not lines[idx - 1].strip()
        next_blank = idx == len(lines) - 1 or not lines[idx + 1].strip()

        if not has_h1 and not normalized_lines and stripped.startswith("## ") and not stripped.startswith("### "):
            title_text = stripped[3:].strip()
            if title_text and not _CLAUSE_LINE_RE.match(title_text):
                normalized_lines.append(f"# {title_text}")
                has_h1 = True
                continue

        if stripped and not stripped.startswith("#") and prev_blank and next_blank:
            # Promote top contract title if no H1 exists yet and first block is uppercase title
            if (
                not has_h1
                and not normalized_lines
                and len(stripped) <= 120
                and stripped == stripped.upper()
                and any(ch.isalpha() for ch in stripped)
            ):
                normalized_lines.append(f"# {stripped}")
                has_h1 = True
                continue

            if len(stripped) <= 140 and _CLAUSE_LINE_RE.match(stripped):
                normalized_lines.append(f"## {stripped}")
                continue

        normalized_lines.append(line)

    joined = "\n".join(normalized_lines).strip()
    return _MULTI_BLANK_LINES_RE.sub("\n\n", joined)


@dataclass(frozen=True)
class _PipelineCacheKey:
    do_ocr: bool
    ocr_mode: str
    primary_language: str
    languages_tuple: tuple[str, ...]
    extract_tables: bool
    ocr_engine: str
    artifacts_path: str | None


class DoclingDocumentConverter:
    """Thread-safe wrapper around Docling's DocumentConverter with pipeline caching."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._lock = threading.Lock()
        self._converters: dict[_PipelineCacheKey, DocumentConverter] = {}

    def convert(
        self,
        document: ValidatedDocument,
        options: ExtractionOptions,
    ) -> ConversionOutputData:
        do_ocr = self._settings.ocr_enabled and options.ocr_mode != "off"
        languages = options.ocr_languages or self._settings.ocr_languages
        primary_language = languages[0] if languages else "es"

        key = _PipelineCacheKey(
            do_ocr=do_ocr,
            ocr_mode=options.ocr_mode,
            primary_language=primary_language,
            languages_tuple=tuple(languages),
            extract_tables=options.extract_tables,
            ocr_engine=self._settings.ocr_engine,
            artifacts_path=self._settings.docling_artifacts_path,
        )

        with self._lock:
            converter = self._get_or_create_converter(key)
            try:
                result = converter.convert(document.path, raises_on_error=False)
            except Exception as exc:
                msg = str(exc).lower()
                if "password" in msg or "encrypted" in msg:
                    raise CorruptDocumentError("Document could not be decoded because it is encrypted.") from exc
                logger.error(
                    "Docling raised an unhandled exception during conversion",
                    extra={"error_type": type(exc).__name__},
                )
                raise ConversionFailedError("Docling failed to convert the document.") from exc

        if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
            error_details = [getattr(err, "error_message", str(err)) for err in (result.errors or [])]
            logger.warning(
                "Docling returned non-success status",
                extra={
                    "conversion_status": str(result.status),
                    "error_count": len(error_details),
                },
            )
            raise ConversionFailedError("Docling could not extract content from the document.")

        if result.document is None:
            raise ConversionFailedError("Docling produced no document structure.")

        raw_markdown = result.document.export_to_markdown(
            escape_underscores=False,
            image_placeholder="<!-- image -->",
        )
        markdown = normalize_contract_markdown(raw_markdown)
        if not markdown.strip():
            raise EmptyExtractionError("No text could be extracted. The document may be a blank or unreadable scan.")

        page_count = self._resolve_page_count(result, document)
        tables = list(getattr(result.document, "tables", []) or [])
        tables_detected = len(tables) if options.extract_tables else 0
        ocr_used = self._resolve_ocr_used(result, document, do_ocr=do_ocr, ocr_mode=options.ocr_mode)
        warnings = self._collect_warnings(
            result=result,
            document=document,
            markdown=markdown,
            page_count=page_count,
            do_ocr=do_ocr,
            ocr_mode=options.ocr_mode,
        )

        return ConversionOutputData(
            markdown=markdown,
            page_count=page_count,
            tables_detected=tables_detected,
            ocr_used=ocr_used,
            warnings=warnings,
        )

    def _get_or_create_converter(self, key: _PipelineCacheKey) -> DocumentConverter:
        cached = self._converters.get(key)
        if cached is not None:
            return cached

        pdf_options = PdfPipelineOptions(
            do_ocr=key.do_ocr,
            do_table_structure=key.extract_tables,
            generate_parsed_pages=True,
            enable_remote_services=False,
            allow_external_plugins=False,
        )
        if key.artifacts_path:
            pdf_options.artifacts_path = Path(key.artifacts_path)

        if key.do_ocr:
            docling_mode = DoclingOcrMode.FULL_PAGE if key.ocr_mode == "on" else DoclingOcrMode.DEFAULT
            if key.ocr_engine == "tesseract":
                pdf_options.ocr_options = TesseractCliOcrOptions(
                    mode=docling_mode,
                    lang=list(key.languages_tuple),
                )
            else:
                pdf_options.ocr_options = RapidOcrOptions(
                    mode=docling_mode,
                    lang=[key.primary_language],
                )

        converter = DocumentConverter(
            allowed_formats=[InputFormat.PDF, InputFormat.DOCX],
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_options),
                InputFormat.DOCX: WordFormatOption(),
            },
        )
        self._converters[key] = converter
        return converter

    @staticmethod
    def _resolve_page_count(result: object, document: ValidatedDocument) -> int | None:
        doc_obj = getattr(result, "document", None)
        if doc_obj is not None and hasattr(doc_obj, "num_pages"):
            try:
                num = int(doc_obj.num_pages())
                if num > 0:
                    return num
            except (TypeError, ValueError):
                logger.debug("Could not read num_pages from Docling document")

        pages = getattr(result, "pages", None)
        if pages and len(pages) > 0:
            return len(pages)

        if document.kind == "pdf" and document.pdf_page_count and document.pdf_page_count > 0:
            return document.pdf_page_count

        return None

    @staticmethod
    def _resolve_ocr_used(
        result: object,
        document: ValidatedDocument,
        *,
        do_ocr: bool,
        ocr_mode: str,
    ) -> bool | None:
        if document.kind == "docx":
            return False
        if not do_ocr:
            return False

        pages = getattr(result, "pages", None)
        if pages:
            for page in pages:
                cells = getattr(page, "cells", None) or []
                if any(getattr(cell, "from_ocr", False) for cell in cells):
                    return True
            return ocr_mode == "on"

        if ocr_mode == "on":
            return True
        return None

    def _collect_warnings(
        self,
        *,
        result: object,
        document: ValidatedDocument,
        markdown: str,
        page_count: int | None,
        do_ocr: bool,
        ocr_mode: str,
    ) -> list[ExtractionWarningItem]:
        warnings: list[ExtractionWarningItem] = []

        if not self._settings.ocr_enabled and ocr_mode != "off" and document.kind == "pdf":
            warnings.append(
                ExtractionWarningItem(
                    code="OCR_GLOBALLY_DISABLED",
                    message="OCR was requested but is disabled by server configuration.",
                )
            )

        status = getattr(result, "status", None)
        errors = getattr(result, "errors", None) or []
        if status == ConversionStatus.PARTIAL_SUCCESS or errors:
            warnings.append(
                ExtractionWarningItem(
                    code="PARTIAL_CONVERSION",
                    message=(
                        "Some regions of the document reported conversion errors and should be verified manually."
                    ),
                )
            )

        doc_obj = getattr(result, "document", None)
        pictures = getattr(doc_obj, "pictures", None) or []
        if len(pictures) > 0:
            warnings.append(
                ExtractionWarningItem(
                    code="EMBEDDED_FIGURES_OMITTED",
                    message=(
                        f"{len(pictures)} embedded figure(s), stamp(s), or signature image(s) "
                        "were detected and omitted from the Markdown representation."
                    ),
                )
            )

        if document.kind == "pdf" and page_count and page_count > 0:
            alpha_chars = sum(1 for ch in markdown if ch.isalnum())
            avg_chars_per_page = alpha_chars / page_count
            if avg_chars_per_page < 40:
                if not do_ocr:
                    warnings.append(
                        ExtractionWarningItem(
                            code="LOW_TEXT_WITHOUT_OCR",
                            message=(
                                "Very little text was extracted while OCR was disabled; the PDF "
                                "may contain scanned pages."
                            ),
                        )
                    )
                else:
                    warnings.append(
                        ExtractionWarningItem(
                            code="LOW_TEXT_DENSITY",
                            message=(
                                "The extracted text density per page is unusually low; verify "
                                "scanned clauses and signatures manually."
                            ),
                        )
                    )

        return warnings
