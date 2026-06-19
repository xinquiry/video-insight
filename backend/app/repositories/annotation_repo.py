import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.annotation import Annotation


class AnnotationRepository:
    def __init__(self, session: AsyncSession):
        self._session = session

    async def create(self, annotation: Annotation) -> Annotation:
        self._session.add(annotation)
        await self._session.commit()
        await self._session.refresh(annotation)
        return annotation

    async def get_by_id(self, annotation_id: uuid.UUID) -> Annotation | None:
        return await self._session.get(Annotation, annotation_id)

    async def list_for_video(self, video_id: uuid.UUID) -> list[Annotation]:
        result = await self._session.execute(
            select(Annotation)
            .where(Annotation.video_id == video_id)
            .order_by(Annotation.timestamp_seconds.asc(), Annotation.created_at.asc())
        )
        return list(result.scalars().all())

    async def update(self, annotation: Annotation) -> Annotation:
        await self._session.commit()
        await self._session.refresh(annotation)
        return annotation

    async def delete(self, annotation: Annotation) -> None:
        await self._session.delete(annotation)
        await self._session.commit()
