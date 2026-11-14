#!/usr/bin/env python3
"""Walks the main flow against the deployed API with an existing account.

Asks for the email and password of a real account, or its access token, and keeps them
in memory only. It never creates accounts. It uploads a synthetic PDF and deletes that contract at the end.

The account gets a row in yzy_contracts.profiles, which stays after the run.

Set E2E_API_URL (and E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY for password
sign-in) for the environment to test. Then run python3 scripts/e2e_deployed.py.
"""

import base64
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "fixtures"))
from synthetic_documents import build_pdf  # noqa: E402

PDF_MIME = "application/pdf"
USER_AGENT = "yzy-contracts-e2e"
CONVERSION_TIMEOUT_SECS = 600
CLAUSES = ("PRIMERA. OBJETO", "SEGUNDA. PRECIO", "TERCERA. DURACION")


def http(method, url, token=None, body=None, raw=None, headers=None):
    request_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    data = raw
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        request_headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    request = urllib.request.Request(url, data=data, method=method, headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            content, status = response.read(), response.status
    except urllib.error.HTTPError as error:
        content, status = error.read(), error.code
    try:
        return status, json.loads(content) if content else None
    except ValueError:
        return status, content


def check(condition, message):
    if not condition:
        raise SystemExit(f"FAILED: {message}")


def step(description):
    print(f"  ok  {description}")


def configured_https_url(name):
    url = os.environ.get(name, "").strip().rstrip("/")
    parts = urlsplit(url)
    check(
        parts.scheme == "https" and parts.hostname and not parts.username
        and not parts.password and not parts.query and not parts.fragment,
        f"set {name} to an HTTPS base URL",
    )
    return url


def sign_in():
    email = input("Email (empty to paste an access token, for Google or Apple accounts): ").strip()
    if not email:
        token = getpass.getpass("Access token: ").strip()
        claims = token.split(".")[1]
        # Only reads the user id to compare with /me. The API is what verifies the signature.
        payload = json.loads(base64.urlsafe_b64decode(claims + "=" * (-len(claims) % 4)))
        return token, payload["sub"]
    auth = configured_https_url("E2E_SUPABASE_URL")
    anon_key = os.environ.get("E2E_SUPABASE_ANON_KEY", "").strip()
    check(anon_key, "set E2E_SUPABASE_ANON_KEY for password sign-in")
    password = getpass.getpass("Password: ")
    status, body = http(
        "POST",
        f"{auth}/auth/v1/token?grant_type=password",
        body={"email": email, "password": password},
        headers={"apikey": anon_key},
    )
    check(
        status == 200 and body.get("access_token"),
        f"sign in failed: http {status} {body.get('error_code') or body.get('error')}",
    )
    return body["access_token"], body["user"]["id"]


def main():
    api = configured_https_url("E2E_API_URL")
    status, _ = http("GET", f"{api}/api/v1/health")
    check(status == 200, f"API not healthy: {status}")

    token, user_id = sign_in()
    step("Signed in with real Supabase Auth")

    status, me = http("GET", f"{api}/api/v1/me", token)
    check(status == 200 and me["id"] == user_id, f"/me failed: {status}")
    step("The API verified the token against the real JWKS")

    pdf = build_pdf()
    status, upload = http(
        "POST",
        f"{api}/api/v1/files/upload-url",
        token,
        {"file_name": "contrato-sintetico.pdf", "mime_type": PDF_MIME, "size_bytes": len(pdf)},
    )
    check(status == 201, f"upload URL failed: {status}")
    status, _ = http(upload["method"], upload["upload_url"], raw=pdf, headers=upload["headers"])
    check(status == 200, f"upload to R2 failed: {status}")
    step("Uploaded a synthetic PDF directly to R2")

    status, contract = http(
        "POST",
        f"{api}/api/v1/contracts",
        token,
        {"upload_id": upload["upload_id"], "name": "Prueba sintética de despliegue"},
    )
    check(status == 201, f"contract registration failed: {status} {contract}")
    contract_uri = f"{api}/api/v1/contracts/{contract['id']}"
    print(f"  ..  contract {contract['id']}")

    try:
        status, download = http("GET", f"{contract_uri}/download-url", token)
        check(status == 200, f"download URL failed: {status}")
        status, stored = http("GET", download["url"])
        check(status == 200 and stored == pdf, "the stored file differs from the upload")
        step("Registered the contract and downloaded the file intact")

        status, job = http("POST", f"{contract_uri}/convert", token, {})
        check(status == 202, f"convert failed: {status} {job}")
        deadline = time.monotonic() + CONVERSION_TIMEOUT_SECS
        while True:
            status, job = http("GET", f"{api}/api/v1/conversions/{job['id']}", token)
            check(status == 200, f"conversion lookup failed: {status}")
            if job["status"] in ("completed", "failed"):
                break
            check(time.monotonic() < deadline, "the conversion did not finish in time")
            time.sleep(2)
        check(job["status"] == "completed", f"conversion failed: {job}")
        step(f"Worker and extractor converted the PDF ({job['page_count']} page)")

        template_uri = f"{api}/api/v1/templates/{job['template_id']}"
        status, template = http("GET", template_uri, token)
        check(status == 200, f"template lookup failed: {status}")
        for clause in CLAUSES:
            check(clause in template["content_markdown"], f"clause missing: {clause}")
        edited = template["content_markdown"] + "\n\nCLÁUSULA AÑADIDA EN LA PRUEBA.\n"
        status, _ = http("PUT", template_uri, token, {"name": template["name"], "content_markdown": edited})
        check(status == 200, f"template update failed: {status}")
        status, saved = http("GET", template_uri, token)
        check(status == 200 and saved["content_markdown"] == edited, "the edit was not saved")
        step("Read and edited the Markdown template")
    finally:
        status, _ = http("DELETE", contract_uri, token)
        print(f"  ..  delete contract: http {status}")

    status, _ = http("GET", contract_uri, token)
    check(status == 404, f"the deleted contract is still visible: {status}")
    step("Deleted the contract")
    print("PASSED")


if __name__ == "__main__":
    main()
