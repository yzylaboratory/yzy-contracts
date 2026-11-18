#!/usr/bin/env python3
"""Add the Contracts DEV callback to the existing shared Auth configuration."""

import os
import stat
import subprocess
import tempfile
from pathlib import Path

STACK = Path("/root/yzylabs-supabase")
KEY = "YZY_AUTH_URI_ALLOW_LIST"
CALLBACK = "https://yzycontracts.yzylabs.dev/auth/callback"
COMPOSE = [
    "docker", "compose", "-f", "docker-compose.yml", "-f", "docker-compose.hetzner.yml",
]


def replace_config(path: Path, content: str, mode: int) -> None:
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        os.fchmod(handle.fileno(), mode)
        handle.write(content)
    temporary.replace(path)


def main() -> None:
    path = STACK / ".env"
    original = path.read_text()
    mode = stat.S_IMODE(path.stat().st_mode)
    lines = original.splitlines(keepends=True)
    index, = (i for i, line in enumerate(lines) if line.startswith(f"{KEY}="))
    redirects = lines[index].strip().split("=", 1)[1].split(",")
    if CALLBACK in redirects:
        print("Contracts DEV callback is already allowed")
        return
    if "https://yzycontracts.yzylabs.com/auth/callback" not in redirects:
        raise SystemExit("Expected the current production callback")
    lines[index] = f"{KEY}={','.join([*redirects, CALLBACK])}\n"
    replace_config(path, "".join(lines), mode)
    recreate = [*COMPOSE, "up", "-d", "--wait", "--wait-timeout", "60", "--no-deps", "auth"]
    try:
        subprocess.run([*COMPOSE, "config", "-q"], cwd=STACK, check=True)
        subprocess.run(recreate, cwd=STACK, check=True)
    except subprocess.CalledProcessError:
        replace_config(path, original, mode)
        subprocess.run(recreate, cwd=STACK, check=True)
        raise


if __name__ == "__main__":
    main()
