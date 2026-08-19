import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.database import get_session
from app.core.security import decode_access_token
from app.models.user import User
from app.repositories.user_repo import UserRepository

DbSession = Annotated[AsyncSession, Depends(get_session)]
CurrentSettings = Annotated[Settings, Depends(get_settings)]
bearer_scheme = HTTPBearer()


async def get_current_user(
    session: DbSession,
    settings: CurrentSettings,
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)],
) -> User:
    claims = decode_access_token(credentials.credentials, settings.secret_key)
    try:
        user_id = uuid.UUID(str(claims["sub"]))
    except (KeyError, ValueError) as exc:
        raise _credentials_error() from exc

    user = await UserRepository(session).get_by_id(user_id)
    if user is None:
        raise _credentials_error()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_current_admin_user(current_user: CurrentUser) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return current_user


CurrentAdminUser = Annotated[User, Depends(get_current_admin_user)]


def _credentials_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
