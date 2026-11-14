from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pypdf import PdfReader
from pypdf.errors import FileNotDecryptedError, PdfReadError

from app.core.exceptions import (
    CorruptDocumentError,
    DocumentTooLargeError,
    EmptyDocumentError,
    PasswordProtectedDocumentError,
    UnsupportedDocumentFormatError,
)
from app.schemas.extraction import SupportedContentType

PDF_MIME: SupportedContentType = "application/pdf"
DOCX_MIME: SupportedContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
ZIP_MAGIC = b"PK\x03\x04"
PDF_MAGIC = b"%PDF-"

MAX_DOCX_ARCHIVE_ENTRIES = 5000
MAX_DOCX_UNCOMPRESSED_RATIO = 25
MIN_DOCX_UNCOMPRESSED_CAP_BYTES = 100 * 1024 * 1024


@dataclass(frozen=True)
class ValidatedDocument:
    path: Path
    filename: str
    content_type: SupportedContentType
    kind: Literal["pdf", "docx"]
    size_bytes: int
    pdf_page_count: int | None = None


class DocumentValidator:
    """Validates declared metadata, magic bytes, encryption state, and structural integrity."""

    def __init__(self, max_file_size_mb: int) -> None:
        self._max_file_size_mb = max_file_size_mb
        self._max_file_size_bytes = max_file_size_mb * 1024 * 1024

    def validate_declared_format(
        self,
        filename: str,
        content_type: str,
    ) -> tuple[SupportedContentType, Literal["pdf", "docx"], str]:
        """Validate filename and content_type before downloading from storage."""
        clean_name = filename.strip()
        if not clean_name:
            raise UnsupportedDocumentFormatError("Document filename must not be empty.")

        normalized_mime = content_type.split(";")[0].strip().lower()
        lower_name = clean_name.lower()

        if normalized_mime == PDF_MIME:
            if not lower_name.endswith(".pdf"):
                raise UnsupportedDocumentFormatError(
                    "Filename extension does not match content_type 'application/pdf'."
                )
            return PDF_MIME, "pdf", ".pdf"

        if normalized_mime == DOCX_MIME:
            if not lower_name.endswith(".docx"):
                raise UnsupportedDocumentFormatError("Filename extension does not match DOCX content_type.")
            return DOCX_MIME, "docx", ".docx"

        raise UnsupportedDocumentFormatError("Only PDF and DOCX files are supported.")

    def validate_downloaded_file(
        self,
        path: Path,
        filename: str,
        content_type: str,
    ) -> ValidatedDocument:
        """Inspect downloaded file size, magic bytes, password protection, and structure."""
        validated_mime, kind, _ = self.validate_declared_format(filename, content_type)

        if not path.exists():
            raise EmptyDocumentError("Downloaded document file does not exist.")

        size_bytes = path.stat().st_size
        if size_bytes == 0:
            raise EmptyDocumentError()
        if size_bytes > self._max_file_size_bytes:
            raise DocumentTooLargeError(self._max_file_size_mb)

        with path.open("rb") as fh:
            header = fh.read(4096)

        if kind == "pdf":
            page_count = self._validate_pdf(path, header)
            return ValidatedDocument(
                path=path,
                filename=filename,
                content_type=validated_mime,
                kind="pdf",
                size_bytes=size_bytes,
                pdf_page_count=page_count,
            )

        self._validate_docx(path, header)
        return ValidatedDocument(
            path=path,
            filename=filename,
            content_type=validated_mime,
            kind="docx",
            size_bytes=size_bytes,
            pdf_page_count=None,
        )

    def _validate_pdf(self, path: Path, header: bytes) -> int:
        if not header.startswith(PDF_MAGIC):
            raise CorruptDocumentError("File does not have a valid PDF header.")

        try:
            reader = PdfReader(str(path), strict=False)
            if reader.is_encrypted:
                raise PasswordProtectedDocumentError()
            page_count = len(reader.pages)
            if page_count <= 0:
                raise CorruptDocumentError("PDF contains no pages.")
            # Touch first page object to catch truncated xref tables early.
            _ = reader.pages[0]
            return page_count
        except PasswordProtectedDocumentError:
            raise
        except FileNotDecryptedError as exc:
            raise PasswordProtectedDocumentError() from exc
        except (PdfReadError, Exception) as exc:
            msg = str(exc).lower()
            if "password" in msg or "decrypt" in msg or "encrypted" in msg:
                raise PasswordProtectedDocumentError() from exc
            raise CorruptDocumentError("PDF structure is corrupt or unreadable.") from exc

    def _validate_docx(self, path: Path, header: bytes) -> None:
        if header.startswith(OLE2_MAGIC):
            if b"E\x00n\x00c\x00r\x00y\x00p\x00t\x00e\x00d\x00P\x00a\x00c\x00k\x00a\x00g\x00e" in header or (
                b"EncryptedPackage" in header
            ):
                raise PasswordProtectedDocumentError()
            raise UnsupportedDocumentFormatError(
                "Legacy binary .doc or encrypted Office containers are not supported; upload an unencrypted .docx."
            )

        if not header.startswith(ZIP_MAGIC):
            raise CorruptDocumentError("File is not a valid OpenXML (.docx) archive.")

        max_uncompressed = max(
            MIN_DOCX_UNCOMPRESSED_CAP_BYTES,
            self._max_file_size_bytes * MAX_DOCX_UNCOMPRESSED_RATIO,
        )

        try:
            with zipfile.ZipFile(path, "r") as archive:
                infos = archive.infolist()
                if not infos or len(infos) > MAX_DOCX_ARCHIVE_ENTRIES:
                    raise CorruptDocumentError("DOCX archive has an invalid number of entries.")

                total_uncompressed = 0
                names: set[str] = set()
                for info in infos:
                    if info.flag_bits & 0x1:
                        raise PasswordProtectedDocumentError()
                    total_uncompressed += max(0, info.file_size)
                    if total_uncompressed > max_uncompressed:
                        raise CorruptDocumentError("DOCX uncompressed content exceeds safe memory limits.")
                    names.add(info.filename)

                if "[Content_Types].xml" not in names or "word/document.xml" not in names:
                    raise CorruptDocumentError(
                        "Archive is missing required WordprocessingML parts (word/document.xml)."
                    )

                # Verify that word/document.xml can be read without CRC errors.
                with archive.open("word/document.xml") as doc_xml:
                    sample = doc_xml.read(256)
                    if not sample.strip():
                        raise CorruptDocumentError("DOCX word/document.xml is empty.")
        except (PasswordProtectedDocumentError, CorruptDocumentError, UnsupportedDocumentFormatError):
            raise
        except zipfile.BadZipFile as exc:
            raise CorruptDocumentError("DOCX ZIP container is corrupt.") from exc
        except Exception as exc:
            raise CorruptDocumentError("DOCX file could not be validated.") from exc
