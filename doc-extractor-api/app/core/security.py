from __future__ import annotations

import secrets

from app.core.config import Settings
from app.core.exceptions import UnauthorizedError


def verify_internal_api_key(provided_key: str | None, settings: Settings) -> None:
    """Validate X-Internal-API-Key in constant time."""
    expected_key = settings.internal_api_key.get_secret_value()
    if not expected_key or not expected_key.strip():
        raise UnauthorizedError("Internal authentication is not configured.")
    if not provided_key:
        raise UnauthorizedError("Missing X-Internal-API-Key header.")

    if not secrets.compare_digest(
        provided_key.encode("utf-8"),
        expected_key.encode("utf-8"),
    ):
        raise UnauthorizedError("Invalid X-Internal-API-Key header.")
