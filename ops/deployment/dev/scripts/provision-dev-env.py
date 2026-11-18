#!/usr/bin/env python3
"""Create private configuration for a new DEV stack."""

import os
import secrets
import subprocess
import sys
from pathlib import Path


def write_new(path: Path, content: str) -> None:
    with path.open("x") as handle:
        handle.write(content)


def main() -> None:
    stack = Path(sys.argv[1]).resolve()
    if (stack / ".env").exists():
        raise SystemExit("DEV configuration already exists")

    auth_keys = dict(
        line.split("=", 1)
        for line in subprocess.check_output(
            [sys.executable, str(stack / "scripts/generate-dev-auth-keys.py")], text=True
        ).splitlines()
    )
    db_admin = secrets.token_urlsafe(36)
    db_runtime = secrets.token_urlsafe(36)
    r2_secret = secrets.token_urlsafe(36)
    extractor = secrets.token_urlsafe(36)
    renderer = secrets.token_urlsafe(36)
    replacements = {
        "__CHANGE_ME_DEV_POSTGRES_PASSWORD__": db_admin,
        "__CHANGE_ME_DEV_APP_ROLE_PASSWORD__": db_runtime,
        "__CHANGE_ME_DEV_R2_ACCESS_KEY_ID__": "dev-local-s3-access-key",
        "__CHANGE_ME_DEV_R2_SECRET_ACCESS_KEY__": r2_secret,
        "__CHANGE_ME_DEV_LOCAL_S3_SECRET__": r2_secret,
        "__CHANGE_ME_DEV_EXTRACTOR_TOKEN__": extractor,
        "__CHANGE_ME_DEV_RENDERER_TOKEN__": renderer,
        "GOTRUE_JWT_SECRET=__CHANGE_ME_GENERATE_WITH_SCRIPT__": (
            f"GOTRUE_JWT_SECRET={auth_keys['GOTRUE_JWT_SECRET']}"
        ),
        "GOTRUE_JWT_KEYS=__CHANGE_ME_GENERATE_WITH_SCRIPT__": (
            f"GOTRUE_JWT_KEYS='{auth_keys['GOTRUE_JWT_KEYS']}'"
        ),
    }

    for example in sorted(stack.glob("*.env.example")):
        if example.name == ".env.example":
            continue
        content = example.read_text()
        for placeholder, value in replacements.items():
            content = content.replace(placeholder, value)
        write_new(example.with_suffix(""), content)

    write_new(
        stack / "auth-admin.env",
        "".join(f"{key}={value}\n" for key, value in auth_keys.items() if key.startswith("DEV_")),
    )
    write_new(stack / ".env", (stack / ".env.example").read_text())


if __name__ == "__main__":
    os.umask(0o077)
    main()
