import uuid
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group


class GroupRepositoryProtocol(Protocol):
    async def create(self, group: Group) -> Group: ...

    async def get_by_id(self, group_id: uuid.UUID) -> Group | None: ...

    async def get_by_name(self, name: str) -> Group | None: ...

    async def list_all(self) -> list[Group]: ...


class GroupRepository:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(self, group: Group) -> Group:
        self._session.add(group)
        await self._session.commit()
        await self._session.refresh(group)
        return group

    async def get_by_id(self, group_id: uuid.UUID) -> Group | None:
        return await self._session.get(Group, group_id)

    async def get_by_name(self, name: str) -> Group | None:
        result = await self._session.execute(select(Group).where(Group.name == name))
        return result.scalar_one_or_none()

    async def list_all(self) -> list[Group]:
        result = await self._session.execute(select(Group).order_by(Group.name.asc()))
        return list(result.scalars().all())
