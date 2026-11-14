#!/usr/bin/env python3
"""Walks the Phase 1 acceptance criteria against a running stack.

Uses real HTTP against Auth, the API and the object store, with synthetic users
and documents. It signs up accounts, so it refuses any non-local Auth host.

    python3 scripts/e2e_local.py
"""

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "fixtures"))
from synthetic_documents import build_blank_pdf, build_docx, build_pdf  # noqa: E402

API = "http://127.0.0.1:8080"
AUTH = "http://127.0.0.1:9999"
PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
CONVERSION_TIMEOUT_SECS = 600

passed = 0


def step(description: str) -> None:
    global passed
    passed += 1
    print(f"  ok {passed:>2}  {description}")


def http(method, url, token=None, body=None, raw=None, headers=None):
    request_headers = dict(headers or {})
    data = None
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        request_headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if raw is not None:
        data = raw
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            content = response.read()
            status = response.status
    except urllib.error.HTTPError as error:
        content = error.read()
        status = error.code
    try:
        return status, json.loads(content) if content else None
    except ValueError:
        return status, content


def check(condition, message):
    if not condition:
        sys.exit(f"FAILED: {message}")


def sign_up() -> tuple[str, str]:
    email = f"e2e-{uuid.uuid4().hex}@ejemplo.test"
    password = uuid.uuid4().hex
    status, body = http("POST", f"{AUTH}/signup", body={"email": email, "password": password})
    check(status == 200 and body.get("access_token"), f"sign up failed: {status}")
    return body["access_token"], body["user"]["id"]


def register(token: str, file_name: str, mime: str, content: bytes, name: str) -> dict:
    status, upload = http(
        "POST",
        f"{API}/api/v1/files/upload-url",
        token,
        {"file_name": file_name, "mime_type": mime, "size_bytes": len(content)},
    )
    check(status == 201, f"upload URL failed: {status} {upload}")
    status, _ = http(
        upload["method"], upload["upload_url"], raw=content, headers=upload["headers"]
    )
    check(status == 200, f"upload to storage failed: {status}")
    status, contract = http(
        "POST",
        f"{API}/api/v1/contracts",
        token,
        {"upload_id": upload["upload_id"], "name": name},
    )
    check(status == 201, f"contract registration failed: {status} {contract}")
    return contract


def wait_for_conversion(token: str, job_id: str) -> dict:
    deadline = time.monotonic() + CONVERSION_TIMEOUT_SECS
    while time.monotonic() < deadline:
        status, job = http("GET", f"{API}/api/v1/conversions/{job_id}", token)
        check(status == 200, f"conversion lookup failed: {status}")
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(2)
    sys.exit("FAILED: the conversion did not finish in time")


def main() -> None:
    check(
        urllib.parse.urlsplit(AUTH).hostname in ("127.0.0.1", "localhost"),
        "this script signs up accounts and only runs against local Auth",
    )

    status, body = http("GET", f"{API}/api/v1/health")
    check(status == 200, f"API not healthy: {status} {body}")

    print("Acceptance criteria")
    token, user_id = sign_up()
    other_token, _ = sign_up()
    step("1. A user authenticates with real Supabase Auth")

    status, me = http("GET", f"{API}/api/v1/me", token)
    check(status == 200 and me["id"] == user_id, f"/me failed: {status} {me}")
    status, _ = http("GET", f"{API}/api/v1/me")
    check(status == 401, "a request without a token must be rejected")
    step("   The API verifies that token against the real JWKS")

    pdf = build_pdf()
    contract = register(token, "contrato-ejemplo.pdf", PDF_MIME, pdf, "Arrendamiento de ejemplo")
    step("2-4. Upload URL issued, PDF stored directly, contract registered")

    contract_uri = f"{API}/api/v1/contracts/{contract['id']}"
    status, fetched = http("GET", contract_uri, token)
    check(status == 200 and fetched["size_bytes"] == len(pdf), f"lookup failed: {fetched}")
    status, page = http("GET", f"{API}/api/v1/contracts?q=arrendamiento", token)
    check(status == 200 and page["total"] == 1, f"search failed: {page}")
    status, download = http("GET", f"{contract_uri}/download-url", token)
    check(status == 200, "download URL failed")
    status, downloaded = http("GET", download["url"])
    check(status == 200 and downloaded == pdf, "the stored file differs from the upload")
    step("5. The contract is queried, searched and its file downloaded intact")

    status, job = http("POST", f"{contract_uri}/convert", token, {})
    check(status == 202, f"convert failed: {status} {job}")
    status, same = http("POST", f"{contract_uri}/convert", token, {})
    if job["status"] in ("pending", "processing") and same["status"] in ("pending", "processing"):
        check(same["id"] == job["id"], "a repeated request created a duplicate job")
    step("6. Conversion requested without blocking, and not duplicated")

    finished = wait_for_conversion(token, job["id"])
    check(finished["status"] == "completed", f"conversion failed: {finished}")
    step(f"7. FastAPI + Docling converted the PDF ({finished['page_count']} page)")

    template_uri = f"{API}/api/v1/templates/{finished['template_id']}"
    status, template = http("GET", template_uri, token)
    check(status == 200, f"template lookup failed: {status}")
    markdown = template["content_markdown"]
    for clause in ("PRIMERA. OBJETO", "SEGUNDA. PRECIO", "TERCERA. DURACION"):
        check(clause in markdown, f"clause missing from the Markdown: {clause}\n{markdown}")
    step("8-9. The Markdown was stored as a template, with every clause present")

    edited = markdown + "\n\nCUARTA. CLÁUSULA AÑADIDA EN LA PRUEBA.\n"
    status, updated = http(
        "PUT",
        template_uri,
        token,
        {"name": "Plantilla editada", "content_markdown": edited},
    )
    check(status == 200, f"template update failed: {status} {updated}")
    step("10-11. The Markdown was edited and saved")

    status, reread = http("GET", template_uri, token)
    check(reread["content_markdown"] == edited, "the edit did not persist")
    check(reread["contract_id"] == contract["id"], "the link to the contract was lost")
    step("12. A new read returns the edit, still linked to the contract")

    status, _ = http("GET", contract_uri, other_token)
    check(status == 404, f"another user reached the contract: {status}")
    status, _ = http("GET", template_uri, other_token)
    check(status == 404, f"another user reached the template: {status}")
    status, _ = http(
        "PUT", template_uri, other_token, {"name": "x", "content_markdown": "robado"}
    )
    check(status == 404, f"another user changed the template: {status}")
    status, _ = http("GET", f"{contract_uri}/download-url", other_token)
    check(status == 404, f"another user got the file: {status}")
    status, _ = http("GET", f"{API}/api/v1/conversions/{job['id']}", other_token)
    check(status == 404, f"another user reached the conversion: {status}")
    step("13. Another user cannot reach the contract, template, file or conversion")

    status, spec = http("GET", f"{API}/api-docs/openapi.json")
    check(status == 200 and "/api/v1/contracts" in spec["paths"], "OpenAPI missing")
    status, ui = http("GET", f"{API}/swagger-ui/")
    check(status == 200 and b"swagger" in ui.lower(), "Swagger UI missing")
    step("14. Swagger UI and the OpenAPI document are served (not clicked through)")

    print("Additional behavior")
    source = build_docx(variables=True)
    docx = register(token, "contrato-ejemplo.docx", DOCX_MIME, source, "Word de ejemplo")
    check(docx["status"] == "converted" and docx["template_id"], "DOCX template not ready")
    check(docx["latest_conversion_id"] is None, "native DOCX must not queue conversion")
    status, conflict = http("POST", f"{API}/api/v1/contracts/{docx['id']}/convert", token, {})
    check(status == 409 and conflict["error"]["code"] == "CONTRACT_ALREADY_CONVERTED", "native DOCX must not convert")
    status, docx_template = http(
        "GET", f"{API}/api/v1/templates/{docx['template_id']}", token
    )
    check(status == 200 and docx_template["content_markdown"] == "", "native DOCX must not store Markdown")
    check(docx_template["native_variables"] == [{"key": "cliente_nombre", "occurrences": 2}], "native variables differ")
    status, download = http("GET", f"{API}/api/v1/contracts/{docx['id']}/download-url", token)
    check(status == 200, "native source URL failed")
    status, stored_source = http("GET", download["url"])
    check(status == 200 and stored_source == source, "native original was changed")
    step("A Word template preserves its original bytes and reads variables without Markdown")

    blank = register(token, "en-blanco.pdf", PDF_MIME, build_blank_pdf(), "PDF sin texto")
    status, blank_job = http("POST", f"{API}/api/v1/contracts/{blank['id']}/convert", token, {})
    blank_finished = wait_for_conversion(token, blank_job["id"])
    check(blank_finished["status"] == "failed", f"a blank PDF must fail: {blank_finished}")
    check(blank_finished["error_code"] == "EMPTY_EXTRACTION", f"wrong code: {blank_finished}")
    step("A PDF with no readable text fails with a clear error, not an empty template")

    status, _ = http("DELETE", contract_uri, token)
    check(status == 204, "delete failed")
    status, _ = http("GET", template_uri, token)
    check(status == 404, "the template must go with the contract")
    deadline = time.monotonic() + 60
    file_gone = False
    while time.monotonic() < deadline and not file_gone:
        status, _ = http("GET", download["url"])
        file_gone = status == 404
        if not file_gone:
            time.sleep(2)
    check(file_gone, "the worker did not remove the file from storage")
    step("Deleting a contract removes its template and, via the worker, its file")

    print(f"\nAll {passed} checks passed.")


if __name__ == "__main__":
    main()
