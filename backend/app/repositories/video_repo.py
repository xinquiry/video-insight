import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.video import Video


class VideoRepository:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(self, video: Video) -> Video:
        self._session.add(video)
        await self._session.commit()
        await self._session.refresh(video)
        return video

    async def get_by_id(self, video_id: uuid.UUID) -> Video | None:
        return await self._session.get(Video, video_id)

    async def get_by_id_for_group(self, video_id: uuid.UUID, group_id: uuid.UUID) -> Video | None:
        result = await self._session.execute(
            select(Video).where(Video.id == video_id, Video.group_id == group_id)
        )
        return result.scalar_one_or_none()

    async def list_paginated(self, group_id: uuid.UUID, page: int, page_size: int) -> tuple[list[Video], int]:
        count_result = await self._session.execute(select(func.count(Video.id)).where(Video.group_id == group_id))
        total = count_result.scalar_one()

        offset = (page - 1) * page_size
        result = await self._session.execute(
            select(Video)
            .where(Video.group_id == group_id)
            .order_by(Video.created_at.desc())
            .offset(offset)
            .limit(page_size)
        )
        return list(result.scalars().all()), total

    async def update(self, video: Video) -> Video:
        await self._session.commit()
        await self._session.refresh(video)
        return video

    async def delete(self, video: Video) -> None:
        await self._session.delete(video)
        await self._session.commit()
