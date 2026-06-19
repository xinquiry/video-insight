import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, status


def hash_password(password: str) -> str:
    iterations = 260_000
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected = password_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    return hmac.compare_digest(digest.hex(), expected)


def create_access_token(payload: dict[str, Any], secret_key: str, expires_delta: timedelta) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    claims = payload | {"exp": int(time.time() + expires_delta.total_seconds())}
    header_part = _base64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_part = _base64url_encode(json.dumps(claims, separators=(",", ":")).encode())
    signature = _sign(f"{header_part}.{payload_part}", secret_key)
    return f"{header_part}.{payload_part}.{signature}"


def decode_access_token(token: str, secret_key: str) -> dict[str, Any]:
    try:
        header_part, payload_part, signature = token.split(".", 2)
    except ValueError as exc:
        raise _credentials_error() from exc

    expected_signature = _sign(f"{header_part}.{payload_part}", secret_key)
    if not hmac.compare_digest(signature, expected_signature):
        raise _credentials_error()

    try:
        claims = json.loads(_base64url_decode(payload_part))
    except (json.JSONDecodeError, ValueError) as exc:
        raise _credentials_error() from exc

    if int(claims.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    return claims


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _base64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(f"{data}{padding}")


def _sign(value: str, secret_key: str) -> str:
    digest = hmac.new(secret_key.encode(), value.encode(), hashlib.sha256).digest()
    return _base64url_encode(digest)


def _credentials_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
