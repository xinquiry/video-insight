from fastapi import APIRouter

from app.core.dependencies import CurrentAdminUser, CurrentSettings, CurrentUser, DbSession
from app.repositories.group_repo import GroupRepository
from app.repositories.user_repo import UserRepository
from app.schemas.auth import TokenRead, UserCreate, UserLogin, UserRead
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth")


def _build_service(session: DbSession, settings: CurrentSettings) -> AuthService:
    return AuthService(repo=UserRepository(session), settings=settings, group_repo=GroupRepository(session))


@router.post("/users", response_model=UserRead, status_code=201)
async def create_user(
    data: UserCreate,
    session: DbSession,
    settings: CurrentSettings,
    _current_admin: CurrentAdminUser,
):
    service = _build_service(session, settings)
    return await service.create_user(data)


@router.post("/login", response_model=TokenRead)
async def login(data: UserLogin, session: DbSession, settings: CurrentSettings):
    service = _build_service(session, settings)
    return await service.login(data)


@router.get("/me", response_model=UserRead)
async def me(current_user: CurrentUser):
    return UserRead.model_validate(current_user)
