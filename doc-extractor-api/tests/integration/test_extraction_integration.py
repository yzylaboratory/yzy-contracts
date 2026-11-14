from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.main import create_app
from app.services.document_converter import ConversionOutputData, DoclingDocumentConverter
from app.services.document_downloader import DocumentDownloader
from app.services.document_validator import (
    DOCX_MIME,
    PDF_MIME,
    DocumentValidator,
    ValidatedDocument,
)
from app.services.extraction_service import ExtractionService
from tests.fixtures.document_builders import (
    build_digital_contract_pdf,
    build_encrypted_pdf,
    ensure_fixture_files,
)

API_KEY = "integration-test-secret-key-987654321"
R2_HOST = "contracts.r2.cloudflarestorage.com"


@pytest.fixture(scope="module")
def base_settings() -> Settings:
    return Settings(
        app_name="Doc Extractor API",
        app_env="test",
        internal_api_key=SecretStr(API_KEY),
        max_file_size_mb=5,
        max_concurrent_extractions=2,
        download_connect_timeout_seconds=5.0,
        download_timeout_seconds=15.0,
        extraction_timeout_seconds=120.0,
        ocr_enabled=True,
        ocr_languages=["es", "en"],
        ocr_engine="rapidocr",
        r2_allowed_hosts=[R2_HOST],
        enable_api_docs=True,
    )


@pytest.fixture(scope="module")
def shared_docling_converter(base_settings: Settings) -> DoclingDocumentConverter:
    """Single real DoclingDocumentConverter instance shared across integration tests."""
    return DoclingDocumentConverter(settings=base_settings)


@pytest.fixture(scope="module")
def fixture_files() -> dict[str, Path]:
    files_dir = Path(__file__).resolve().parent.parent / "fixtures" / "files"
    return ensure_fixture_files(files_dir)


def _build_test_app(
    settings: Settings,
    converter: object,
    handler,  # type: ignore[no-untyped-def]
):
    transport = httpx.MockTransport(handler)
    downloader = DocumentDownloader(
        settings=settings,
        transport=transport,
        dns_resolver=lambda _h, _p: ["104.18.2.35"],
    )
    validator = DocumentValidator(max_file_size_mb=settings.max_file_size_mb)
    service = ExtractionService(
        settings=settings,
        downloader=downloader,
        validator=validator,
        converter=converter,  # type: ignore[arg-type]
    )
    return create_app(settings=settings, extraction_service=service)


async def test_extract_digital_pdf_spanish_tables_and_lists(
    base_settings: Settings,
    shared_docling_converter: DoclingDocumentConverter,
    fixture_files: dict[str, Path],
) -> None:
    pdf_bytes = fixture_files["digital_pdf"].read_bytes()

    def r2_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": PDF_MIME, "Content-Length": str(len(pdf_bytes))},
            content=pdf_bytes,
        )

    app = _build_test_app(base_settings, shared_docling_converter, r2_handler)
    job_id = str(uuid4())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/internal/v1/extract",
            headers={"X-Internal-API-Key": API_KEY},
            json={
                "job_id": job_id,
                "document": {
                    "filename": "contrato_digital.pdf",
                    "content_type": PDF_MIME,
                    "download_url": f"https://{R2_HOST}/users/u1/contrato_digital.pdf?X-Amz-Signature=sig",
                },
                "options": {
                    "ocr_mode": "auto",
                    "ocr_languages": ["es", "en"],
                    "extract_tables": True,
                },
            },
        )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["job_id"] == job_id
    assert data["status"] == "completed"
    assert data["document"] == {
        "filename": "contrato_digital.pdf",
        "content_type": PDF_MIME,
        "page_count": 1,
    }
    markdown = data["extraction"]["markdown"]
    assert "CONTRATO DE SERVICIOS PROFESIONALES" in markdown
    assert "PRIMERA: OBJETO DEL CONTRATO" in markdown
    assert "República Dominicana" in markdown
    assert "1. Entregar informes técnicos mensuales." in markdown
    assert "RD$50,000.00" in markdown
    assert "|" in markdown
    assert data["extraction"]["metadata"]["tables_detected"] >= 1
    assert data["extraction"]["metadata"]["ocr_used"] is False
    assert data["extraction"]["metadata"]["duration_ms"] > 0


async def test_extract_scanned_pdf_with_ocr(
    base_settings: Settings,
    shared_docling_converter: DoclingDocumentConverter,
    fixture_files: dict[str, Path],
) -> None:
    scanned_bytes = fixture_files["scanned_pdf"].read_bytes()

    def r2_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": PDF_MIME, "Content-Length": str(len(scanned_bytes))},
            content=scanned_bytes,
        )

    app = _build_test_app(base_settings, shared_docling_converter, r2_handler)
    job_id = str(uuid4())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/internal/v1/extract",
            headers={"X-Internal-API-Key": API_KEY},
            json={
                "job_id": job_id,
                "document": {
                    "filename": "contrato_escaneado.pdf",
                    "content_type": PDF_MIME,
                    "download_url": f"https://{R2_HOST}/users/u1/contrato_escaneado.pdf?X-Amz-Signature=sig",
                },
                "options": {
                    "ocr_mode": "auto",
                    "ocr_languages": ["es", "en"],
                    "extract_tables": True,
                },
            },
        )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "completed"
    assert data["document"]["page_count"] == 1
    assert data["extraction"]["metadata"]["ocr_used"] is True
    markdown = data["extraction"]["markdown"].upper()
    assert "ARRENDAMIENTO" in markdown
    assert "PRIMERA" in markdown
    assert "ALQUILER" in markdown
    assert "45000" in markdown


async def test_extract_docx_with_tables_and_numbered_lists(
    base_settings: Settings,
    shared_docling_converter: DoclingDocumentConverter,
    fixture_files: dict[str, Path],
) -> None:
    docx_bytes = fixture_files["contract_docx"].read_bytes()

    def r2_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": DOCX_MIME, "Content-Length": str(len(docx_bytes))},
            content=docx_bytes,
        )

    app = _build_test_app(base_settings, shared_docling_converter, r2_handler)
    job_id = str(uuid4())

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        response = await client.post(
            "/internal/v1/extract",
            headers={"X-Internal-API-Key": API_KEY},
            json={
                "job_id": job_id,
                "document": {
                    "filename": "contrato_servicios.docx",
                    "content_type": DOCX_MIME,
                    "download_url": f"https://{R2_HOST}/users/u1/contrato_servicios.docx?X-Amz-Signature=sig",
                },
                "options": {
                    "ocr_mode": "auto",
                    "ocr_languages": ["es", "en"],
                    "extract_tables": True,
                },
            },
        )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["job_id"] == job_id
    assert data["status"] == "completed"
    assert data["document"]["content_type"] == DOCX_MIME
    assert data["extraction"]["metadata"]["tables_detected"] == 1
    assert data["extraction"]["metadata"]["ocr_used"] is False
    markdown = data["extraction"]["markdown"]
    assert "# CONTRATO DE SERVICIOS" in markdown
    assert "PRIMERA: OBJETO DEL CONTRATO" in markdown
    assert "República Dominicana" in markdown
    assert "RD$50,000" in markdown
    assert "Anticipo inicial" in markdown
    assert "RD$25,000" in markdown


async def test_error_cases_corrupt_expired_interrupted_oversized_and_unauthorized(
    base_settings: Settings,
    shared_docling_converter: DoclingDocumentConverter,
) -> None:
    def router_handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/corrupt.pdf"):
            return httpx.Response(200, content=b"%PDF-1.7 broken content without xref")
        if path.endswith("/encrypted.pdf"):
            return httpx.Response(200, content=build_encrypted_pdf("secret"))
        if path.endswith("/expired-r2.pdf"):
            xml = (
                b"<?xml version='1.0' encoding='UTF-8'?>"
                b"<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>"
            )
            return httpx.Response(403, content=xml)
        if path.endswith("/missing.pdf"):
            return httpx.Response(404, content=b"Not Found")
        if path.endswith("/interrupted.pdf"):
            raise httpx.ReadError("Simulated connection reset during R2 stream")
        if path.endswith("/oversized.pdf"):
            return httpx.Response(
                200,
                headers={"Content-Length": str(20 * 1024 * 1024)},
                content=b"%PDF-1.7",
            )
        return httpx.Response(200, content=build_digital_contract_pdf())

    app = _build_test_app(base_settings, shared_docling_converter, router_handler)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        # 1. Missing API key -> 401
        unauth = await client.post("/internal/v1/extract", json={})
        assert unauth.status_code == 401
        assert unauth.json()["error"]["code"] == "UNAUTHORIZED"

        # 2. Corrupt PDF -> 422
        corrupt = await client.post(
            "/internal/v1/extract",
            headers={"X-Internal-API-Key": API_KEY},
            json={
                "job_id": str(uuid4()),
                "document": {
                    "filename": "corrupt.pdf",
                    "content_type": PDF_MIME,
                    "download_url": f"https://{R2_HOST}/corrupt.pdf",
                },
            },
        )
        assert corrupt.status_code == 422
        assert corrupt.json()["error"]["code"] == "CORRUPT_DOCUMENT"

        # 3. Encrypted PDF -> 422
        encrypted = await client.post(
            "/internal/v1/extract",
            headers={"X-Internal-API-Key": API_KEY},
            json={
                "job_id": str(uuid4()),
                "document": {
                    "filename": "encrypted.pdf",
                    "content_type": PDF_MIME,
                    "download_url": f"https://{R2_HOST}/encrypted.pdf",
                },
            },
        )
        assert encrypted.status_code == 422
        assert encrypted.json()["error"]["code"] == "PASSWORD_PROTECTED_DOCUMENT"

        # 4. Expired URL (R2 403 Request has expired) -> 410
        expired_r2 = await client.post(
            "/internal/v1/extract",
            headers={"X-Internal-API-Key": API_KEY},
            json={
                "job_id": str(uuid4()),
                "document": {
                    "filename": "expired-r2.pdf",
                    "content_type": PDF_MIME,
                    "download_url": f"https://{R2_HOST}/expired-r2.pdf",
                },
            },
        )
        assert expired_r2.status_code == 410
        assert expired_r2.json()["error"]["code"] == "PRESIGNED_URL_EXPIRED"

        # 5. Expired URL (SigV4 query timestamp) -> 410
        past = (datetime.now(UTC) - timedelta(hours=1)).strftime("%Y%m%dT%H%M%SZ")
        expired_query = await client.post(
            "/internal/v1/extract",
            headers={"X-Internal-API-Key": API_KEY},
            json={
                "job_id": str(uuid4()),
                "document": {
                    "filename": "expired.pdf",
                    "content_type": PDF_MIME,
                    "download_url": f"https://{R2_HOST}/expired.pdf?X-Amz-Date={past}&X-Amz-Expires=60",
                },
            },
        )
        assert expired_query.status_code == 410
        assert expired_query.json()["error"]["code"] == "PRESIGNED_URL_EXPIRED"

        # 6. Interrupted download -> 502
        interrupted = await client.post(
            "/internal/v1/extract",
            headers={"X-Internal-API-Key": API_KEY},
            json={
                "job_id": str(uuid4()),
                "document": {
                    "filename": "interrupted.pdf",
                    "content_type": PDF_MIME,
                    "download_url": f"https://{R2_HOST}/interrupted.pdf",
                },
            },
        )
        assert interrupted.status_code == 502
        assert interrupted.json()["error"]["code"] == "DOWNLOAD_FAILED"

        # 7. Oversized file -> 413
        oversized = await client.post(
            "/internal/v1/extract",
            headers={"X-Internal-API-Key": API_KEY},
            json={
                "job_id": str(uuid4()),
                "document": {
                    "filename": "oversized.pdf",
                    "content_type": PDF_MIME,
                    "download_url": f"https://{R2_HOST}/oversized.pdf",
                },
            },
        )
        assert oversized.status_code == 413
        assert oversized.json()["error"]["code"] == "DOCUMENT_TOO_LARGE"


async def test_bounded_concurrency_limit() -> None:
    single_slot_settings = Settings(
        app_name="Doc Extractor API",
        app_env="test",
        internal_api_key=SecretStr(API_KEY),
        max_file_size_mb=5,
        max_concurrent_extractions=1,
        r2_allowed_hosts=[R2_HOST],
    )

    pdf_bytes = build_digital_contract_pdf()

    class SlowConverter:
        def convert(self, document: ValidatedDocument, options: object) -> ConversionOutputData:
            import time

            time.sleep(0.25)
            return ConversionOutputData(
                markdown="# CONTRATO\n\nTexto",
                page_count=1,
                tables_detected=0,
                ocr_used=False,
                warnings=[],
            )

    app = _build_test_app(
        single_slot_settings,
        SlowConverter(),
        lambda _req: httpx.Response(200, content=pdf_bytes),
    )

    payload = {
        "job_id": str(uuid4()),
        "document": {
            "filename": "contrato.pdf",
            "content_type": PDF_MIME,
            "download_url": f"https://{R2_HOST}/contrato.pdf",
        },
    }

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://testserver",
    ) as client:
        req1 = asyncio.create_task(
            client.post(
                "/internal/v1/extract",
                headers={"X-Internal-API-Key": API_KEY},
                json=payload,
            )
        )
        await asyncio.sleep(0.05)
        req2 = asyncio.create_task(
            client.post(
                "/internal/v1/extract",
                headers={"X-Internal-API-Key": API_KEY},
                json={**payload, "job_id": str(uuid4())},
            )
        )
        resp1, resp2 = await asyncio.gather(req1, req2)

    statuses = sorted([resp1.status_code, resp2.status_code])
    assert statuses == [200, 429]
    rejected = resp2 if resp2.status_code == 429 else resp1
    assert rejected.json()["error"]["code"] == "TOO_MANY_CONCURRENT_EXTRACTIONS"
