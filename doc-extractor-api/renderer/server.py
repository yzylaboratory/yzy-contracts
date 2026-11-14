"""Private DOCX-to-PDF service. The public Contracts API owns authentication."""

from __future__ import annotations

import hmac
import io
import json
import os
import signal
import subprocess
import tempfile
import threading
import zipfile
from contextlib import suppress
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
MAX_BYTES = 20 * 1024 * 1024
MAX_EXPANDED_BYTES = 100 * 1024 * 1024
MAX_RELATIONSHIP_BYTES = 1024 * 1024
MAX_ENTRIES = 4096
RENDER_SECONDS = 22
SLOTS = threading.BoundedSemaphore(1)


class RenderError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code


def invalid_docx() -> RenderError:
    return RenderError(422, "INVALID_DOCX", "The file is not a supported Word document.")


def validate_docx(content: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as package:
            members = package.infolist()
            names = {member.filename for member in members}
            if not {"[Content_Types].xml", "word/document.xml"}.issubset(names) or len(names) != len(members):
                raise invalid_docx()
            if len(members) > MAX_ENTRIES or sum(member.file_size for member in members) > MAX_EXPANDED_BYTES:
                raise RenderError(413, "DOCX_TOO_LARGE", "The Word document expands beyond the supported size.")

            for member in members:
                path = PurePosixPath(member.filename)
                if path.is_absolute() or ".." in path.parts or "\\" in member.filename or member.flag_bits & 1:
                    raise invalid_docx()
                if path.name.lower() == "vbaproject.bin" or member.filename.lower().startswith("word/activex/"):
                    raise invalid_docx()
                if not member.filename.lower().endswith(".rels"):
                    continue
                if member.file_size > MAX_RELATIONSHIP_BYTES:
                    raise invalid_docx()
                relations = package.read(member).decode("utf-8-sig")
                if "<!DOCTYPE" in relations.upper():
                    raise invalid_docx()
                # Bounded UTF-8 input above rejects DTDs before parsing.
                for relation in ElementTree.fromstring(relations):  # noqa: S314
                    if relation.get("TargetMode", "").lower() == "external" and not relation.get("Type", "").endswith(
                        "/hyperlink"
                    ):
                        raise RenderError(
                            422,
                            "DOCX_EXTERNAL_RESOURCE",
                            "Embed the linked resources in the Word document before rendering.",
                        )
    except (ElementTree.ParseError, UnicodeError, zipfile.BadZipFile, NotImplementedError, RuntimeError) as error:
        raise invalid_docx() from error


def render_pdf(content: bytes) -> bytes:
    validate_docx(content)
    with tempfile.TemporaryDirectory(prefix="render-") as directory:
        work = Path(directory)
        source = work / "document.docx"
        source.write_bytes(content)
        profile = work / "profile"
        profile_settings = profile / "user" / "registrymodifications.xcu"
        profile_settings.parent.mkdir(parents=True)
        profile_settings.write_text(
            '<oor:items xmlns:oor="http://openoffice.org/2001/registry">'
            '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
            '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>'
            "</item></oor:items>",
            encoding="utf-8",
        )
        # The executable and arguments are fixed or private temporary paths.
        process = subprocess.Popen(  # noqa: S603
            [
                "/usr/bin/libreoffice",
                f"-env:UserInstallation={profile.as_uri()}",
                "--headless",
                "--norestore",
                "--convert-to",
                "pdf:writer_pdf_Export",
                "--outdir",
                directory,
                str(source),
            ],
            cwd=work,
            env={"HOME": directory, "TMPDIR": directory, "LANG": "C.UTF-8", "PATH": "/usr/bin:/bin"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            status = process.wait(timeout=RENDER_SECONDS)
        except subprocess.TimeoutExpired as error:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise RenderError(503, "RENDER_TIMEOUT", "PDF conversion timed out.") from error
        pdf = work / "document.pdf"
        if status != 0 or not pdf.is_file():
            raise RenderError(422, "DOCX_RENDER_FAILED", "The Word document could not be rendered as PDF.")
        if pdf.stat().st_size > MAX_BYTES:
            raise RenderError(413, "PDF_TOO_LARGE", "The generated PDF exceeds the supported size.")
        result = pdf.read_bytes()
        if not result.startswith(b"%PDF-"):
            raise RenderError(422, "DOCX_RENDER_FAILED", "The renderer did not produce a valid PDF.")
        return result


class RendererServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], token: str):
        self.token = token.encode()
        super().__init__(address, Handler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address


class Handler(BaseHTTPRequestHandler):
    server: RendererServer
    server_version = "DocumentRenderer"
    sys_version = ""

    def log_message(self, _format: str, *args: object) -> None:
        # The public API supplies operational logging without document data.
        pass

    def send_payload(self, status: int, mime: str, content: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        with suppress(BrokenPipeError, ConnectionResetError, TimeoutError):
            self.wfile.write(content)

    def send_error_payload(self, error: RenderError) -> None:
        content = json.dumps({"error": {"code": error.code, "message": str(error)}}).encode()
        self.send_payload(error.status, "application/json", content)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_payload(200, "application/json", b'{"status":"ok"}')
        else:
            self.send_error_payload(RenderError(404, "NOT_FOUND", "Resource not found."))

    def do_POST(self) -> None:
        if self.path != "/v1/render/pdf":
            self.send_error_payload(RenderError(404, "NOT_FOUND", "Resource not found."))
            return
        credential = self.headers.get("X-Internal-API-Key", "").encode()
        if not hmac.compare_digest(self.server.token, credential):
            self.send_error_payload(RenderError(401, "UNAUTHORIZED", "Authentication is required."))
            return
        if self.headers.get_content_type() != DOCX:
            self.send_error_payload(invalid_docx())
            return
        lengths = self.headers.get_all("Content-Length", [])
        if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isdigit():
            self.send_error_payload(RenderError(422, "INVALID_LENGTH", "A valid content length is required."))
            return
        if len(lengths[0]) > 8 or int(lengths[0]) > MAX_BYTES:
            self.send_error_payload(RenderError(413, "DOCX_TOO_LARGE", "The Word document exceeds the supported size."))
            return
        if not SLOTS.acquire(blocking=False):
            self.send_error_payload(RenderError(503, "RENDER_BUSY", "The renderer is busy. Try again shortly."))
            return
        try:
            size = int(lengths[0])
            content = self.rfile.read(size)
            if not size or len(content) != size:
                raise invalid_docx()
            self.send_payload(200, "application/pdf", render_pdf(content))
        except RenderError as error:
            self.send_error_payload(error)
        except TimeoutError:
            self.send_error_payload(RenderError(503, "RENDER_TIMEOUT", "The request timed out."))
        except OSError:
            self.send_error_payload(RenderError(503, "RENDER_UNAVAILABLE", "The renderer is temporarily unavailable."))
        finally:
            SLOTS.release()


if __name__ == "__main__":
    secret = os.environ["DOCUMENT_RENDERER_API_TOKEN"].strip()
    if len(secret) < 32:
        raise RuntimeError("DOCUMENT_RENDERER_API_TOKEN must contain at least 32 characters")
    RendererServer(("0.0.0.0", 8080), secret).serve_forever()
