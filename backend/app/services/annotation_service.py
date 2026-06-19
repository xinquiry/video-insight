import uuid

from fastapi import HTTPException, status

from app.models.annotation import Annotation
from app.repositories.annotation_repo import AnnotationRepository
from app.repositories.video_repo import VideoRepository
from app.schemas.annotation import AnnotationCreate, AnnotationRead, AnnotationUpdate


class AnnotationService:
    def __init__(self, repo: AnnotationRepository, video_repo: VideoRepository):
        self._repo = repo
        self._video_repo = video_repo

    async def create(self, video_id: uuid.UUID, data: AnnotationCreate) -> AnnotationRead:
        await self._ensure_video(video_id)
        annotation = Annotation(video_id=video_id, **data.model_dump())
        annotation = await self._repo.create(annotation)
        return AnnotationRead.model_validate(annotation)

    async def list_for_video(self, video_id: uuid.UUID) -> list[AnnotationRead]:
        await self._ensure_video(video_id)
        annotations = await self._repo.list_for_video(video_id)
        return [AnnotationRead.model_validate(annotation) for annotation in annotations]

    async def update(self, annotation_id: uuid.UUID, data: AnnotationUpdate) -> AnnotationRead:
        annotation = await self._get_annotation(annotation_id)
        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(annotation, field, value)
        annotation = await self._repo.update(annotation)
        return AnnotationRead.model_validate(annotation)

    async def delete(self, annotation_id: uuid.UUID) -> None:
        annotation = await self._get_annotation(annotation_id)
        await self._repo.delete(annotation)

    async def _ensure_video(self, video_id: uuid.UUID) -> None:
        video = await self._video_repo.get_by_id(video_id)
        if not video:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")

    async def _get_annotation(self, annotation_id: uuid.UUID) -> Annotation:
        annotation = await self._repo.get_by_id(annotation_id)
        if not annotation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")
        return annotation
