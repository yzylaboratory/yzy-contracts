#!/usr/bin/env python3
"""Generate isolated DEV-only Auth secrets and asymmetric ES256 JWKS material.

Requires openssl on PATH. Prints env lines to stdout; redirect directly to a
mode-0600 host file or copy into 1Password. Never reuse keys from PROD.
"""

from __future__ import annotations

import base64
import json
import secrets
import subprocess
import tempfile
import time
import uuid
from pathlib import Path


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def der_ecdsa_to_p1363(der: bytes) -> bytes:
    # DER SEQUENCE { INTEGER r, INTEGER s } -> 64-byte raw (r || s) for ES256.
    if len(der) < 8 or der[0] != 0x30:
        raise ValueError("unexpected ECDSA DER signature")
    idx = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    if der[idx] != 0x02:
        raise ValueError("missing r integer")
    r_len = der[idx + 1]
    r = der[idx + 2 : idx + 2 + r_len].lstrip(b"\x00").rjust(32, b"\x00")
    idx = idx + 2 + r_len
    if der[idx] != 0x02:
        raise ValueError("missing s integer")
    s_len = der[idx + 1]
    s = der[idx + 2 : idx + 2 + s_len].lstrip(b"\x00").rjust(32, b"\x00")
    if len(r) != 32 or len(s) != 32:
        raise ValueError("invalid P-256 scalar length")
    return r + s


def sign_es256(key_pem_path: Path, kid: str, payload: dict[str, object]) -> str:
    header = {"alg": "ES256", "typ": "JWT", "kid": kid}
    signing_input = (
        f"{b64url(json.dumps(header, separators=(',', ':')).encode())}."
        f"{b64url(json.dumps(payload, separators=(',', ':')).encode())}"
    )
    der_sig = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(key_pem_path)],
        input=signing_input.encode("ascii"),
        check=True,
        capture_output=True,
    ).stdout
    return f"{signing_input}.{b64url(der_ecdsa_to_p1363(der_sig))}"


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        key_pem = tmp_path / "ec-p256.pem"
        subprocess.run(
            ["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", str(key_pem)],
            check=True,
        )
        der_key = subprocess.run(
            ["openssl", "ec", "-in", str(key_pem), "-outform", "DER"],
            check=True,
            capture_output=True,
        ).stdout

        # SEC1 DER layout for prime256v1: 32-byte private scalar at [7:39], 65-byte uncompressed point at [-65:].
        private_scalar = der_key[7:39]
        public_point = der_key[-65:]
        if len(private_scalar) != 32 or public_point[0] != 0x04:
            raise RuntimeError("unexpected EC key encoding from openssl")

        kid = str(uuid.uuid4())
        private_jwk = {
            "kty": "EC",
            "crv": "P-256",
            "alg": "ES256",
            "use": "sig",
            "kid": kid,
            "key_ops": ["sign", "verify"],
            "d": b64url(private_scalar),
            "x": b64url(public_point[1:33]),
            "y": b64url(public_point[33:65]),
        }

        jwt_secret = secrets.token_urlsafe(48)
        now = int(time.time())
        exp = now + 5 * 365 * 24 * 3600
        anon_jwt = sign_es256(key_pem, kid, {"role": "anon", "iss": "supabase", "iat": now, "exp": exp})
        service_jwt = sign_es256(
            key_pem, kid, {"role": "service_role", "iss": "supabase", "iat": now, "exp": exp}
        )

        print(f"GOTRUE_JWT_SECRET={jwt_secret}")
        print(f"GOTRUE_JWT_KEYS={json.dumps([private_jwk], separators=(',', ':'))}")
        print(f"DEV_SUPABASE_ANON_KEY={anon_jwt}")
        print(f"DEV_SUPABASE_SERVICE_ROLE_KEY={service_jwt}")


if __name__ == "__main__":
    main()
