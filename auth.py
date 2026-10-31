"""Accounts for the web app: register, log in, and JWT session tokens.

- Passwords are hashed with scrypt (Python's hashlib; no extra dependency) and a random salt per user.
  The plain password is never stored or logged.
- Users live in a small SQLite file (config.AUTH_DB).
- A session is a JWT (HS256, signed with config.JWT_SECRET) that expires after JWT_TTL_HOURS. api.py
  puts it in an HttpOnly cookie, so page scripts cannot read it and the live event stream and the
  contradiction-map iframe are authenticated without exposing the token in URLs.
- Failed logins are rate-limited per email (LOGIN_MAX_FAILURES in LOGIN_WINDOW_SECONDS).
"""

import contextlib
import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time
from pathlib import Path

import jwt

import config

LOGIN_MAX_FAILURES = 5
LOGIN_WINDOW_SECONDS = 15 * 60
MIN_PASSWORD_LENGTH = 8
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_SCRYPT = {"n": 2**14, "r": 8, "p": 1}

# Used only when JWT_SECRET is not set: valid until the process exits.
_EPHEMERAL_SECRET = secrets.token_urlsafe(48)
_lock = threading.Lock()
_failures: dict[str, list[float]] = {}


class AuthError(Exception):
    """A user-facing problem: `status` is the HTTP status, `message` is safe to show."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def secret() -> str:
    return config.JWT_SECRET or _EPHEMERAL_SECRET


# ---------------------------------------------------------------- passwords


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${_SCRYPT['n']}${_SCRYPT['r']}${_SCRYPT['p']}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, n, r, p, salt, digest = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(got.hex(), digest)


# ---------------------------------------------------------------- user store


@contextlib.contextmanager
def _db():
    """A connection that commits on success and is always closed."""
    Path(config.AUTH_DB).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.AUTH_DB)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            " id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,"
            " password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)"
        )
        with conn:
            yield conn
    finally:
        conn.close()


def _public(row: sqlite3.Row) -> dict:
    return {"id": str(row["id"]), "email": row["email"], "name": row["name"], "created_at": row["created_at"]}


def register(name: str, email: str, password: str) -> dict:
    name, email = name.strip(), email.strip().lower()
    if not 1 <= len(name) <= 80:
        raise AuthError(422, "Enter your name (up to 80 characters).")
    if not EMAIL_RE.match(email) or len(email) > 254:
        raise AuthError(422, "Enter a valid email address.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AuthError(422, f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password) > 256:
        raise AuthError(422, "Password is too long.")
    with _lock, _db() as conn:
        if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise AuthError(409, "An account with this email already exists. Sign in instead.")
        cur = conn.execute(
            "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (email, name, hash_password(password), int(time.time() * 1000)),
        )
        row = conn.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _public(row)


def login(email: str, password: str) -> dict:
    email = email.strip().lower()
    now = time.time()
    with _lock:
        recent = [t for t in _failures.get(email, []) if now - t < LOGIN_WINDOW_SECONDS]
        _failures[email] = recent
    if len(recent) >= LOGIN_MAX_FAILURES:
        raise AuthError(429, "Too many failed sign-in attempts. Try again in 15 minutes.")
    with _db() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    # Same message whether the email or the password is wrong, so emails cannot be probed.
    if row is None or not verify_password(password, row["password_hash"]):
        with _lock:
            _failures.setdefault(email, []).append(now)
        raise AuthError(401, "Incorrect email or password.")
    with _lock:
        _failures.pop(email, None)
    return _public(row)


def get_user(user_id: str) -> dict | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _public(row) if row else None


# ---------------------------------------------------------------- tokens


def create_token(user: dict) -> str:
    now = int(time.time())
    claims = {"sub": user["id"], "email": user["email"], "name": user["name"], "iat": now,
              "exp": now + config.JWT_TTL_HOURS * 3600, "iss": "apollo"}
    return jwt.encode(claims, secret(), algorithm="HS256")


def user_from_token(token: str) -> dict | None:
    """The user a valid, unexpired token belongs to, or None. The account must still exist."""
    try:
        claims = jwt.decode(token, secret(), algorithms=["HS256"], issuer="apollo", options={"require": ["exp", "sub"]})
    except jwt.PyJWTError:
        return None
    return get_user(str(claims["sub"]))
