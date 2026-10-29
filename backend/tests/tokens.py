"""Test-only JWT helpers.

Generates HS256 tokens signed with a deterministic key so the backend can
verify them without reaching out to Cognito.  The key, issuer and audience
are injected into the environment before the app is imported (see conftest.py).
"""

from __future__ import annotations

import os
import time

import jwt

_TEST_SECRET = "test-secret-key-for-unit-tests-only"
_TEST_ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST"
_TEST_CLIENT_ID = "test-client-id"

# Inject settings so the app trusts these tokens.
os.environ["COGNITO_REGION"] = "us-east-1"
os.environ["COGNITO_USER_POOL_ID"] = "us-east-1_TEST"
os.environ["COGNITO_CLIENT_ID"] = _TEST_CLIENT_ID

# Tell the auth module to use a symmetric key instead of JWKS.
os.environ["COGNITO_JWKS"] = ""  # cleared — we patch the verifier below


# Default test user
_ALICE_SUB = "alice-sub-00000000"
_ALICE_EMAIL = "alice@example.com"


def make_token(sub: str = _ALICE_SUB, email: str = _ALICE_EMAIL) -> str:
    """Mint a signed JWT for the given user.  Valid for 1 hour."""
    now = int(time.time())
    payload = {
        "sub": sub,
        "email": email,
        "aud": _TEST_CLIENT_ID,
        "iss": _TEST_ISSUER,
        "iat": now,
        "exp": now + 3600,
        "token_use": "id",
    }
    return jwt.encode(payload, _TEST_SECRET, algorithm="HS256")


def auth(sub: str = _ALICE_SUB, email: str = _ALICE_EMAIL) -> dict[str, str]:
    """Return an ``Authorization`` header dict for the given user."""
    return {"Authorization": f"Bearer {make_token(sub, email)}"}


def install_test_verifier() -> None:
    """Monkey-patch ``app.auth`` so it accepts HS256 tokens signed with the test secret.

    Must be called **after** the app module is imported but **before** any request.
    """
    import app.auth as auth_mod

    class _FakeSigningKey:
        def __init__(self):
            self.key = _TEST_SECRET

    class _FakeJWKClient:
        def get_signing_key_from_jwt(self, token: str):  # noqa: ARG002
            return _FakeSigningKey()

    # Replace the cached JWKS client so tokens are verified with the test secret.
    # We override the decode call indirectly: the signing key returned is the
    # shared HS256 secret, and we also patch algorithms accepted.
    auth_mod._jwks.cache_clear()

    # Instead of patching _get_current_user, we patch _jwks to return our fake client
    # and override the jwt.decode call to accept HS256.
    _original_decode = jwt.decode

    def _patched_decode(token, key, **kwargs):
        kwargs["algorithms"] = ["HS256"]
        return _original_decode(token, key, **kwargs)

    jwt.decode = _patched_decode  # type: ignore[assignment]
    auth_mod._jwks = lambda settings: _FakeJWKClient()  # type: ignore[assignment]


# Auto-install when imported from tests
install_test_verifier()
