from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx

from app.core.config import Settings
from app.core.exceptions import (
    DocumentNotFoundError,
    DocumentTooLargeError,
    DownloadFailedError,
    DownloadTimeoutError,
    EmptyDocumentError,
    ForbiddenDownloadUrlError,
    PresignedUrlExpiredError,
    StorageAccessDeniedError,
)
from app.core.logging import redact_url

logger = logging.getLogger(__name__)

CHUNK_SIZE_BYTES = 64 * 1024
MAX_ERROR_BODY_BYTES = 4096

ResolverFunc = Callable[[str, int], list[str]]


def default_dns_resolver(hostname: str, port: int) -> list[str]:
    """Resolve hostname to IP addresses via system getaddrinfo."""
    infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    ips: list[str] = []
    for info in infos:
        sockaddr = info[4]
        ip_str = str(sockaddr[0])
        if ip_str not in ips:
            ips.append(ip_str)
    return ips


def _is_forbidden_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return True

    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        addr = addr.ipv4_mapped

    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def _is_presigned_url_expired_by_query(query: str, now: datetime | None = None) -> bool:
    """Inspect AWS SigV4 query parameters (X-Amz-Date and X-Amz-Expires) if present."""
    params = parse_qs(query, keep_blank_values=False)
    lowered = {k.lower(): v for k, v in params.items()}
    amz_date_vals = lowered.get("x-amz-date")
    amz_expires_vals = lowered.get("x-amz-expires")
    if not amz_date_vals or not amz_expires_vals:
        return False
    try:
        signed_at = datetime.strptime(amz_date_vals[0], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
        expires_seconds = int(amz_expires_vals[0])
    except (ValueError, IndexError):
        return False

    current_time = now or datetime.now(UTC)
    return current_time > (signed_at + timedelta(seconds=expires_seconds))


@dataclass(frozen=True)
class DownloadMetrics:
    size_bytes: int
    duration_ms: int
    content_type_header: str | None


class DocumentDownloader:
    """Secure streaming HTTP downloader for Cloudflare R2 presigned URLs."""

    def __init__(
        self,
        settings: Settings,
        transport: httpx.AsyncBaseTransport | None = None,
        dns_resolver: ResolverFunc | None = None,
    ) -> None:
        self._settings = settings
        self._transport = transport
        self._dns_resolver = dns_resolver or default_dns_resolver

    async def validate_download_url(self, url: str) -> tuple[str, int]:
        """Validate URL scheme, credentials, allowed R2 host, expiration, and resolved IPs."""
        try:
            parsed = urlsplit(url)
        except Exception as exc:
            raise ForbiddenDownloadUrlError("Malformed download URL.") from exc

        if parsed.scheme.lower() != "https":
            raise ForbiddenDownloadUrlError("Only HTTPS download URLs are permitted.")

        if parsed.username or parsed.password:
            raise ForbiddenDownloadUrlError("Credentials in download URLs are not permitted.")

        hostname = (parsed.hostname or "").lower()
        if not hostname:
            raise ForbiddenDownloadUrlError("Download URL is missing a valid hostname.")

        try:
            port = parsed.port or 443
        except ValueError as exc:
            raise ForbiddenDownloadUrlError("Download URL contains an invalid port.") from exc

        if port != 443:
            raise ForbiddenDownloadUrlError("Only standard HTTPS port 443 is permitted.")

        # Reject raw IP literals immediately.
        try:
            ipaddress.ip_address(hostname)
            raise ForbiddenDownloadUrlError("Direct IP addresses are not permitted in download URLs.")
        except ValueError:
            pass

        allowed_hosts = set(self._settings.r2_allowed_hosts)
        if not allowed_hosts:
            raise ForbiddenDownloadUrlError("No R2 allowed hosts are configured.")

        if hostname not in allowed_hosts:
            raise ForbiddenDownloadUrlError(f"Host '{hostname}' is not in the configured R2_ALLOWED_HOSTS allowlist.")

        if _is_presigned_url_expired_by_query(parsed.query):
            raise PresignedUrlExpiredError("The presigned download URL has expired.")

        try:
            resolved_ips = await asyncio.to_thread(self._dns_resolver, hostname, port)
        except socket.gaierror as exc:
            raise DownloadFailedError("Could not resolve storage host DNS.") from exc

        if not resolved_ips:
            raise ForbiddenDownloadUrlError("Storage host resolved to no IP addresses.")

        for ip_str in resolved_ips:
            if _is_forbidden_ip(ip_str):
                raise ForbiddenDownloadUrlError("Storage host resolved to a private, loopback, or reserved IP address.")

        return hostname, port

    async def download_to_path(self, url: str, destination: Path) -> DownloadMetrics:
        """Stream the document from R2 to `destination`, enforcing size and timeout limits."""
        await self.validate_download_url(url)
        safe_url = redact_url(url)
        max_bytes = self._settings.max_file_size_bytes

        timeout = httpx.Timeout(
            timeout=self._settings.download_timeout_seconds,
            connect=self._settings.download_connect_timeout_seconds,
            read=self._settings.download_timeout_seconds,
        )

        start = time.perf_counter()
        bytes_written = 0

        try:
            async with (
                httpx.AsyncClient(
                    timeout=timeout,
                    follow_redirects=False,
                    transport=self._transport,
                ) as client,
                client.stream("GET", url) as response,
            ):
                if response.is_redirect or (300 <= response.status_code < 400):
                    raise ForbiddenDownloadUrlError("Redirects are not permitted when downloading from storage.")

                if response.status_code == 404:
                    raise DocumentNotFoundError()

                if response.status_code in (401, 403):
                    error_snippet = await self._read_bounded_error_body(response)
                    if "expired" in error_snippet.lower() or "request has expired" in error_snippet.lower():
                        raise PresignedUrlExpiredError()
                    raise StorageAccessDeniedError()

                if response.status_code == 410:
                    raise PresignedUrlExpiredError()

                if response.status_code >= 400:
                    raise DownloadFailedError(f"Storage returned unexpected HTTP status {response.status_code}.")

                content_length_raw = response.headers.get("content-length")
                if content_length_raw is not None:
                    try:
                        declared_length = int(content_length_raw)
                    except ValueError:
                        declared_length = None
                    if declared_length is not None:
                        if declared_length == 0:
                            raise EmptyDocumentError()
                        if declared_length > max_bytes:
                            raise DocumentTooLargeError(self._settings.max_file_size_mb)

                with destination.open("wb") as file_handle:
                    async for chunk in response.aiter_bytes(chunk_size=CHUNK_SIZE_BYTES):
                        if not chunk:
                            continue
                        bytes_written += len(chunk)
                        if bytes_written > max_bytes:
                            raise DocumentTooLargeError(self._settings.max_file_size_mb)
                        file_handle.write(chunk)

                if bytes_written == 0:
                    raise EmptyDocumentError()

                duration_ms = int((time.perf_counter() - start) * 1000)
                content_type_header = response.headers.get("content-type")
                logger.info(
                    "Document downloaded from R2",
                    extra={
                        "storage_url": safe_url,
                        "size_bytes": bytes_written,
                        "download_duration_ms": duration_ms,
                    },
                )
                return DownloadMetrics(
                    size_bytes=bytes_written,
                    duration_ms=duration_ms,
                    content_type_header=content_type_header,
                )

        except (
            ForbiddenDownloadUrlError,
            DocumentNotFoundError,
            PresignedUrlExpiredError,
            StorageAccessDeniedError,
            DocumentTooLargeError,
            EmptyDocumentError,
            DownloadFailedError,
        ):
            self._unlink_quietly(destination)
            raise
        except httpx.TimeoutException as exc:
            self._unlink_quietly(destination)
            raise DownloadTimeoutError() from exc
        except httpx.HTTPError as exc:
            self._unlink_quietly(destination)
            raise DownloadFailedError("Network or stream failure while downloading document.") from exc
        except Exception:
            self._unlink_quietly(destination)
            raise

    @staticmethod
    async def _read_bounded_error_body(response: httpx.Response) -> str:
        chunks: list[bytes] = []
        total = 0
        try:
            async for chunk in response.aiter_bytes(chunk_size=1024):
                chunks.append(chunk)
                total += len(chunk)
                if total >= MAX_ERROR_BODY_BYTES:
                    break
        except Exception:
            return ""
        return b"".join(chunks)[:MAX_ERROR_BODY_BYTES].decode("utf-8", errors="ignore")

    @staticmethod
    def _unlink_quietly(path: Path) -> None:
        try:
            if path.exists():
                path.unlink()
        except OSError:
            pass
