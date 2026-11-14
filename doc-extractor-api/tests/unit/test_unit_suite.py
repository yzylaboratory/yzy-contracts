from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.core.config import Settings
from app.core.exceptions import (
    CorruptDocumentError,
    DocumentTooLargeError,
    EmptyDocumentError,
    ForbiddenDownloadUrlError,
    PasswordProtectedDocumentError,
    PresignedUrlExpiredError,
    UnauthorizedError,
    UnsupportedDocumentFormatError,
)
from app.core.logging import redact_url
from app.core.security import verify_internal_api_key
from app.main import create_app
from app.schemas.extraction import ExtractionOptions
from app.services.document_converter import normalize_contract_markdown
from app.services.document_downloader import DocumentDownloader
from app.services.document_validator import DOCX_MIME, PDF_MIME, DocumentValidator
from app.utils.temporary_files import temporary_document_path
from tests.fixtures.document_builders import (
    build_contract_docx,
    build_digital_contract_pdf,
    build_encrypted_pdf,
)


def make_settings(**overrides: object) -> Settings:
    defaults: dict[str, object] = {
        "app_name": "Doc Extractor API",
        "app_env": "test",
        "internal_api_key": SecretStr("unit-test-secret-key-123456"),
        "max_file_size_mb": 5,
        "max_concurrent_extractions": 2,
        "r2_allowed_hosts": ["contracts.r2.cloudflarestorage.com"],
        "ocr_enabled": True,
        "ocr_languages": ["es", "en"],
        "enable_api_docs": True,
    }
    defaults.update(overrides)
    return Settings(**defaults)  # type: ignore[arg-type]


class DummyExtractionService:
    async def extract(self, request):  # type: ignore[no-untyped-def]
        raise NotImplementedError


def test_api_key_verification_constant_time() -> None:
    settings = make_settings()
    verify_internal_api_key("unit-test-secret-key-123456", settings)

    with pytest.raises(UnauthorizedError):
        verify_internal_api_key(None, settings)

    with pytest.raises(UnauthorizedError):
        verify_internal_api_key("wrong-key", settings)

    unconfigured = make_settings(internal_api_key=SecretStr(""))
    with pytest.raises(UnauthorizedError):
        verify_internal_api_key("unit-test-secret-key-123456", unconfigured)


def test_temporary_files_cleanup_on_success_and_error() -> None:
    captured_dir: Path | None = None
    with temporary_document_path(suffix=".pdf") as temp_file:
        captured_dir = temp_file.parent
        temp_file.write_bytes(b"%PDF-1.7 dummy")
        assert temp_file.exists()
        assert (captured_dir.stat().st_mode & 0o777) == 0o700

    assert captured_dir is not None
    assert not captured_dir.exists()

    failed_dir: Path | None = None
    with pytest.raises(RuntimeError, match="boom"), temporary_document_path(suffix=".docx") as temp_file:
        failed_dir = temp_file.parent
        temp_file.write_bytes(b"partial data")
        raise RuntimeError("boom")

    assert failed_dir is not None
    assert not failed_dir.exists()


def test_document_validator_formats_and_files(tmp_path: Path) -> None:
    validator = DocumentValidator(max_file_size_mb=1)

    mime, kind, suffix = validator.validate_declared_format("contrato.pdf", PDF_MIME)
    assert (mime, kind, suffix) == (PDF_MIME, "pdf", ".pdf")

    mime, kind, suffix = validator.validate_declared_format("contrato.docx", DOCX_MIME)
    assert (mime, kind, suffix) == (DOCX_MIME, "docx", ".docx")

    with pytest.raises(UnsupportedDocumentFormatError):
        validator.validate_declared_format("contrato.doc", "application/msword")

    with pytest.raises(UnsupportedDocumentFormatError):
        validator.validate_declared_format("contrato.txt", PDF_MIME)

    with pytest.raises(UnsupportedDocumentFormatError):
        validator.validate_declared_format("contrato.pdf", DOCX_MIME)

    # Empty file
    empty_pdf = tmp_path / "empty.pdf"
    empty_pdf.write_bytes(b"")
    with pytest.raises(EmptyDocumentError):
        validator.validate_downloaded_file(empty_pdf, "empty.pdf", PDF_MIME)

    # Too large file
    large_pdf = tmp_path / "large.pdf"
    large_pdf.write_bytes(b"%PDF-1.7\n" + b"0" * (1024 * 1024 + 100))
    with pytest.raises(DocumentTooLargeError):
        validator.validate_downloaded_file(large_pdf, "large.pdf", PDF_MIME)

    # Corrupt PDF
    corrupt_pdf = tmp_path / "corrupt.pdf"
    corrupt_pdf.write_bytes(b"not a pdf at all")
    with pytest.raises(CorruptDocumentError):
        validator.validate_downloaded_file(corrupt_pdf, "corrupt.pdf", PDF_MIME)

    # Password-protected PDF
    encrypted_pdf = tmp_path / "encrypted.pdf"
    encrypted_pdf.write_bytes(build_encrypted_pdf("clave123"))
    with pytest.raises(PasswordProtectedDocumentError):
        validator.validate_downloaded_file(encrypted_pdf, "encrypted.pdf", PDF_MIME)

    # Password-protected / OLE2 EncryptedPackage DOCX
    encrypted_docx = tmp_path / "encrypted.docx"
    encrypted_docx.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64 + b"EncryptedPackage")
    with pytest.raises(PasswordProtectedDocumentError):
        validator.validate_downloaded_file(encrypted_docx, "encrypted.docx", DOCX_MIME)

    # Corrupt DOCX
    corrupt_docx = tmp_path / "corrupt.docx"
    corrupt_docx.write_bytes(b"PK\x03\x04not-a-valid-zip")
    with pytest.raises(CorruptDocumentError):
        validator.validate_downloaded_file(corrupt_docx, "corrupt.docx", DOCX_MIME)

    # Valid PDF & DOCX
    valid_pdf = tmp_path / "valid.pdf"
    valid_pdf.write_bytes(build_digital_contract_pdf())
    validated_pdf = validator.validate_downloaded_file(valid_pdf, "valid.pdf", PDF_MIME)
    assert validated_pdf.kind == "pdf"
    assert validated_pdf.pdf_page_count == 1

    valid_docx = tmp_path / "valid.docx"
    valid_docx.write_bytes(build_contract_docx())
    validated_docx = validator.validate_downloaded_file(valid_docx, "valid.docx", DOCX_MIME)
    assert validated_docx.kind == "docx"


async def test_r2_url_validation_and_ssrf_protection() -> None:
    settings = make_settings(r2_allowed_hosts=["contracts.r2.cloudflarestorage.com"])
    public_resolver = lambda host, port: ["104.18.2.35"]  # noqa: E731
    downloader = DocumentDownloader(settings=settings, dns_resolver=public_resolver)

    host, port = await downloader.validate_download_url(
        "https://contracts.r2.cloudflarestorage.com/bucket/file.pdf?X-Amz-Signature=abc"
    )
    assert (host, port) == ("contracts.r2.cloudflarestorage.com", 443)

    # Reject HTTP
    with pytest.raises(ForbiddenDownloadUrlError, match="HTTPS"):
        await downloader.validate_download_url("http://contracts.r2.cloudflarestorage.com/bucket/file.pdf")

    # Reject unauthorized host
    with pytest.raises(ForbiddenDownloadUrlError, match="allowlist"):
        await downloader.validate_download_url("https://evil.example.com/bucket/file.pdf")

    # Reject IP literal
    with pytest.raises(ForbiddenDownloadUrlError):
        await downloader.validate_download_url("https://104.18.2.35/bucket/file.pdf")

    # Reject non-443 port
    with pytest.raises(ForbiddenDownloadUrlError, match="port"):
        await downloader.validate_download_url("https://contracts.r2.cloudflarestorage.com:8443/bucket/file.pdf")

    # Reject embedded credentials
    with pytest.raises(ForbiddenDownloadUrlError, match="Credentials"):
        await downloader.validate_download_url("https://user:pass@contracts.r2.cloudflarestorage.com/bucket/file.pdf")

    # Reject private/loopback/link-local DNS resolution (SSRF protection)
    for forbidden_ip in ["127.0.0.1", "10.0.0.8", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1"]:
        ssrf_downloader = DocumentDownloader(
            settings=settings,
            dns_resolver=lambda _h, _p, ip=forbidden_ip: [ip],  # type: ignore[misc]
        )
        with pytest.raises(ForbiddenDownloadUrlError, match="private, loopback, or reserved"):
            await ssrf_downloader.validate_download_url("https://contracts.r2.cloudflarestorage.com/bucket/file.pdf")

    # Reject expired SigV4 query parameter
    past = (datetime.now(UTC) - timedelta(hours=2)).strftime("%Y%m%dT%H%M%SZ")
    expired_url = (
        f"https://contracts.r2.cloudflarestorage.com/bucket/file.pdf"
        f"?X-Amz-Date={past}&X-Amz-Expires=60&X-Amz-Signature=deadbeef"
    )
    with pytest.raises(PresignedUrlExpiredError):
        await downloader.validate_download_url(expired_url)


async def test_downloader_rejects_redirects(tmp_path: Path) -> None:
    settings = make_settings(r2_allowed_hosts=["contracts.r2.cloudflarestorage.com"])
    transport = httpx.MockTransport(lambda _req: httpx.Response(302, headers={"Location": "http://127.0.0.1/secret"}))
    downloader = DocumentDownloader(
        settings=settings,
        transport=transport,
        dns_resolver=lambda _h, _p: ["104.18.2.35"],
    )
    dest = tmp_path / "out.pdf"
    with pytest.raises(ForbiddenDownloadUrlError, match="Redirects"):
        await downloader.download_to_path(
            "https://contracts.r2.cloudflarestorage.com/bucket/file.pdf",
            dest,
        )
    assert not dest.exists()


def test_url_redaction_strips_presigned_query() -> None:
    presigned = (
        "https://contracts.r2.cloudflarestorage.com/users/1/contrato.pdf"
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=supersecret"
    )
    redacted = redact_url(presigned)
    assert redacted == "https://contracts.r2.cloudflarestorage.com/users/1/contrato.pdf"
    assert "supersecret" not in redacted
    assert "X-Amz-Signature" not in redacted


def test_ocr_configuration_and_markdown_normalization() -> None:
    opts = ExtractionOptions(ocr_mode="auto", ocr_languages=["es", "en"], extract_tables=True)
    assert opts.ocr_languages == ["es", "en"]

    with pytest.raises(ValidationError):
        ExtractionOptions(ocr_mode="auto", ocr_languages=["fr"])

    with pytest.raises(ValidationError):
        make_settings(ocr_languages="de,fr")

    sample = (
        "CONTRATO DE SERVICIOS\n\n"
        "PRIMERA: OBJETO DEL CONTRATO\n\n"
        "El contratista se compromete a prestar los servicios descritos.\n\n\n\n"
        "SEGUNDA: MONTO\n\n"
        "El monto acordado es RD$50,000.\n"
        "<!-- image -->\n"
    )
    normalized = normalize_contract_markdown(sample)
    assert normalized == (
        "# CONTRATO DE SERVICIOS\n\n"
        "## PRIMERA: OBJETO DEL CONTRATO\n\n"
        "El contratista se compromete a prestar los servicios descritos.\n\n"
        "## SEGUNDA: MONTO\n\n"
        "El monto acordado es RD$50,000."
    )


def test_health_readiness_and_docs_toggle() -> None:
    app_with_docs = create_app(
        settings=make_settings(enable_api_docs=True),
        extraction_service=DummyExtractionService(),  # type: ignore[arg-type]
    )
    client = TestClient(app_with_docs)

    health_resp = client.get("/health")
    assert health_resp.status_code == 200
    assert health_resp.json() == {
        "status": "ok",
        "service": "doc-extractor-api",
        "version": "0.1.0",
    }
    assert "X-Request-Id" in health_resp.headers

    ready_resp = client.get("/ready")
    assert ready_resp.status_code == 200
    assert ready_resp.json()["status"] == "ready"

    assert client.get("/docs").status_code == 200
    assert client.get("/openapi.json").status_code == 200

    app_without_docs = create_app(
        settings=make_settings(enable_api_docs=False),
        extraction_service=DummyExtractionService(),  # type: ignore[arg-type]
    )
    prod_client = TestClient(app_without_docs)
    assert prod_client.get("/docs").status_code == 404
    assert prod_client.get("/redoc").status_code == 404
    assert prod_client.get("/openapi.json").status_code == 404
