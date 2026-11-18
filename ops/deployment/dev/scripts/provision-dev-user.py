#!/usr/bin/env python3
"""Create a password account in the private DEV GoTrue service."""

import argparse
import getpass
import ipaddress
import json
import os
import subprocess
import urllib.error
import urllib.request
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email")
    parser.add_argument("--password-file", type=Path)
    parser.add_argument("--superadmin", action="store_true")
    args = parser.parse_args()
    stack = Path(__file__).resolve().parent.parent

    address = subprocess.check_output(
        ["docker", "inspect", "-f",
         '{{(index .NetworkSettings.Networks "yzy-contracts-dev-edge-net").IPAddress}}',
         "yzy-contracts-dev-auth"], text=True
    ).strip()
    if not ipaddress.IPv4Address(address).is_private:
        raise SystemExit("Expected a private DEV Auth address")

    keys = dict(line.split("=", 1) for line in (stack / "auth-admin.env").read_text().splitlines())
    password = args.password_file.read_text().rstrip("\r\n") if args.password_file else getpass.getpass()
    if len(password) < 12:
        raise SystemExit("DEV passwords require at least 12 characters")
    data = json.dumps({"email": args.email, "password": password, "email_confirm": True}).encode()
    req = urllib.request.Request(
        f"http://{address}:9999/admin/users",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {keys['DEV_SUPABASE_SERVICE_ROLE_KEY']}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            user = json.load(response)
    except urllib.error.HTTPError as error:
        code = json.load(error).get("error_code", "unknown")
        raise SystemExit(f"DEV Auth rejected account creation (HTTP {error.code}, {code})")

    if args.superadmin:
        config = stack / "api.access.env"
        updated = {
            "CONTRACTS_SUPERADMIN_ID": user["id"],
            "CONTRACTS_SUPERADMIN_EMAIL": user["email"],
        }
        pending = config.with_suffix(".env.new")
        with pending.open("x") as output:
            for key, value in updated.items():
                output.write(f"{key}={value}\n")
        pending.replace(config)
    print(user["id"])


if __name__ == "__main__":
    os.umask(0o077)
    main()
