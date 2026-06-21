from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.models.group import Group
from app.repositories.group_repo import GroupRepositoryProtocol
from app.schemas.group import GroupCreate, GroupRead


class GroupService:
    def __init__(self, repo: GroupRepositoryProtocol):
        self._repo = repo

    async def create(self, data: GroupCreate) -> GroupRead:
        group = Group(name=data.name.strip())
        try:
            group = await self._repo.create(group)
        except IntegrityError as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Group already exists") from exc
        return GroupRead.model_validate(group)

    async def list_all(self) -> list[GroupRead]:
        groups = await self._repo.list_all()
        return [GroupRead.model_validate(group) for group in groups]
