#!/usr/bin/env python3
"""Prints LOCAL_GOTRUE_JWT_KEYS for the local Auth service. Requires openssl.

The key signs tokens only in the local stack. Never reuse it elsewhere.
"""

import base64
import json
import subprocess
import uuid


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def main() -> None:
    pem = subprocess.run(
        ["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout", "-outform", "DER"],
        check=True,
        capture_output=True,
    ).stdout
    # SEC1 layout: fixed header, 32-byte private scalar, then the public point at the end.
    private_scalar = pem[7:39]
    public_point = pem[-65:]
    jwk = {
        "kty": "EC",
        "crv": "P-256",
        "alg": "ES256",
        "use": "sig",
        "kid": str(uuid.uuid4()),
        "key_ops": ["sign", "verify"],
        "d": b64url(private_scalar),
        "x": b64url(public_point[1:33]),
        "y": b64url(public_point[33:65]),
    }
    print("LOCAL_GOTRUE_JWT_KEYS='" + json.dumps([jwk], separators=(",", ":")) + "'")


if __name__ == "__main__":
    main()
