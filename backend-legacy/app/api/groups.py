from fastapi import APIRouter

from app.core.dependencies import CurrentAdminUser, DbSession
from app.repositories.group_repo import GroupRepository
from app.schemas.group import GroupCreate, GroupRead
from app.services.group_service import GroupService

router = APIRouter(prefix="/groups")


def _build_service(session: DbSession) -> GroupService:
    return GroupService(repo=GroupRepository(session))


@router.get("", response_model=list[GroupRead])
async def list_groups(session: DbSession, _current_admin: CurrentAdminUser):
    service = _build_service(session)
    return await service.list_all()


@router.post("", response_model=GroupRead, status_code=201)
async def create_group(data: GroupCreate, session: DbSession, _current_admin: CurrentAdminUser):
    service = _build_service(session)
    return await service.create(data)
