from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.repositories.user_repo import UserRepository
from app.schemas.auth import TokenRead, UserCreate, UserLogin, UserRead


class AuthService:
    def __init__(self, repo: UserRepository, settings: Settings):
        self._repo = repo
        self._settings = settings

    async def register(self, data: UserCreate) -> TokenRead:
        user = User(username=data.username, password_hash=hash_password(data.password))
        try:
            user = await self._repo.create(user)
        except IntegrityError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists") from exc
        return self._token_for_user(user)

    async def login(self, data: UserLogin) -> TokenRead:
        user = await self._repo.get_by_username(data.username)
        if not user or not verify_password(data.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
        return self._token_for_user(user)

    def _token_for_user(self, user: User) -> TokenRead:
        token = create_access_token(
            {"sub": str(user.id), "username": user.username},
            self._settings.secret_key,
            timedelta(minutes=self._settings.access_token_expire_minutes),
        )
        return TokenRead(access_token=token, user=UserRead.model_validate(user))
