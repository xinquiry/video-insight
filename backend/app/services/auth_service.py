from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.repositories.group_repo import GroupRepositoryProtocol
from app.repositories.user_repo import UserRepositoryProtocol
from app.schemas.auth import TokenRead, UserCreate, UserLogin, UserRead


class AuthService:
    def __init__(
        self,
        repo: UserRepositoryProtocol,
        settings: Settings,
        group_repo: GroupRepositoryProtocol | None = None,
    ):
        self._repo = repo
        self._settings = settings
        self._group_repo = group_repo

    async def create_user(self, data: UserCreate) -> UserRead:
        if self._group_repo and not await self._group_repo.get_by_id(data.group_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
        user = User(
            username=data.username,
            password_hash=hash_password(data.password),
            group_id=data.group_id,
            is_admin=False,
        )
        try:
            user = await self._repo.create(user)
        except IntegrityError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists") from exc
        return UserRead.model_validate(user)

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
