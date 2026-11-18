#!/usr/bin/env python3
"""Configure the existing DEV API stack using values piped from the shared host."""

import ipaddress
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlsplit


def update_config(path: Path, updates: dict[str, str]) -> None:
    lines = path.read_text().splitlines() if path.exists() else []
    remaining = [line for line in lines if line.partition("=")[0] not in updates]
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
        os.fchmod(handle.fileno(), 0o600)
        content = [*remaining, *(f"{key}={value}" for key, value in updates.items())]
        handle.write("\n".join(content) + "\n")
    Path(handle.name).replace(path)


def main() -> None:
    stack = Path(__file__).resolve().parent.parent
    values = json.load(sys.stdin)
    host = ipaddress.IPv4Address(values["host"])
    owner, member = (str(uuid.UUID(values[key])) for key in ("owner", "member"))
    password = values["password"]
    issuer = values["issuer"]
    if not host.is_private or len(password) != 64 or any(c not in "0123456789abcdef" for c in password):
        raise SystemExit("Expected a private host and a generated DEV database password")
    if owner == member or not (stack / "shared-postgres-ca.crt").is_file():
        raise SystemExit("Expected two shared Auth identities and the database CA")
    if any(c.isspace() for c in issuer) or urlsplit(issuer).scheme not in {"https", "http"}:
        raise SystemExit("Expected the shared Auth issuer")

    update_config(stack / "api.env", {
        "CONTRACTS_DATABASE_SCHEMA": "yzy_contracts_dev",
        "DATABASE_URL": (
            f"postgres://yzy_contracts_dev_app:{password}@{host}:55432/postgres"
            "?sslmode=verify-full&sslrootcert=/run/shared-postgres-ca.crt"
        ),
        "SUPABASE_JWKS_URL": f"http://{host}:58888/auth/v1/.well-known/jwks.json",
        "SUPABASE_JWT_ISSUER": issuer,
        "SUPABASE_JWT_AUDIENCE": "authenticated",
    })
    update_config(stack / "api.access.env", {
        "CONTRACTS_SUPERADMIN_ID": owner,
        "CONTRACTS_SUPERADMIN_EMAIL": "admin@yzylabs.com",
        "CONTRACTS_ALLOWED_USER_IDS": f"{owner},{member}",
    })


if __name__ == "__main__":
    main()
