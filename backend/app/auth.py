"""Cognito JWT verification as a FastAPI dependency.

When ``auth_configured`` is *False* (e.g. no pool ID / client ID set) every
protected endpoint answers **503** so the API is never accidentally open.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings, get_settings

_bearer = HTTPBearer(auto_error=False)


class _TokenPayload:
    """Verified claims extracted from the Cognito ``id_token``."""

    __slots__ = ("sub", "email")

    def __init__(self, sub: str, email: str | None) -> None:
        self.sub = sub
        self.email = email


class _StaticJWKClient(jwt.PyJWKClient):
    """JWKS client populated from a static JSON payload (used e.g. in Lambda)."""

    def __init__(self, jwks_data: dict[str, Any]) -> None:
        super().__init__(uri="https://static.cognito.internal")
        self._jwks_data = jwks_data

    def fetch_data(self) -> Any:
        return self._jwks_data


@lru_cache(maxsize=4)
def _jwks_client_from_url(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url)


@lru_cache(maxsize=1)
def _jwks_client_from_json(jwks_json: str) -> jwt.PyJWKClient:
    return _StaticJWKClient(json.loads(jwks_json))


def _jwks(settings: Settings) -> jwt.PyJWKClient | None:
    """Return a cached JWK client, downloading the key set lazily.

    If ``COGNITO_JWKS`` is set (Lambda), use that instead of fetching.
    Cached on the hashable JWKS URL / JSON string.
    """
    if not settings.auth_configured:
        return None

    if settings.cognito_jwks:
        return _jwks_client_from_json(settings.cognito_jwks)

    return _jwks_client_from_url(f"{settings.cognito_issuer}/.well-known/jwks.json")


def _clear_jwks_cache() -> None:
    _jwks_client_from_url.cache_clear()
    _jwks_client_from_json.cache_clear()


_jwks.cache_clear = _clear_jwks_cache  # type: ignore[attr-defined]


async def _get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> _TokenPayload:
    """Validate the Bearer token and return verified claims.

    * **No Cognito configured** → 503 (fail closed).
    * **No / invalid token** → 401.
    """
    if not settings.auth_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured",
        )

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    jwk_client = _jwks(settings)
    assert jwk_client is not None  # auth_configured guarantees this

    try:
        signing_key = jwk_client.get_signing_key_from_jwt(credentials.credentials)
        payload = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.cognito_client_id,
            issuer=settings.cognito_issuer,
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing 'sub' claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return _TokenPayload(sub=sub, email=payload.get("email"))


# The dependency other modules import
CurrentUser = Annotated[_TokenPayload, Depends(_get_current_user)]
