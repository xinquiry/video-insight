import uuid
from contextlib import suppress

from fastapi import HTTPException, UploadFile, status

from app.models.video import Video
from app.repositories.video_repo import VideoRepository
from app.schemas.common import PaginatedResponse
from app.schemas.video import VideoRead, VideoUpdate
from app.services.storage_service import StorageService


class VideoService:
    def __init__(self, repo: VideoRepository, storage: StorageService):
        self._repo = repo
        self._storage = storage

    async def create(self, title: str, description: str | None, upload: UploadFile) -> VideoRead:
        size = upload.size
        if size is None:
            current_position = upload.file.tell()
            upload.file.seek(0, 2)
            size = upload.file.tell()
            upload.file.seek(current_position)

        content_type = upload.content_type or "application/octet-stream"
        if not content_type.startswith("video/"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file must be a video")

        object_key = f"videos/{uuid.uuid4()}-{upload.filename or 'video'}"
        upload.file.seek(0)
        self._storage.upload_video(object_key, upload.file, size, content_type)

        try:
            video = Video(
                title=title,
                description=description,
                object_key=object_key,
                original_filename=upload.filename or "video",
                content_type=content_type,
                size_bytes=size,
            )
            video = await self._repo.create(video)
        except Exception:
            with suppress(Exception):
                self._storage.delete_video(object_key)
            raise
        return self._read(video)

    async def get_by_id(self, video_id: uuid.UUID) -> VideoRead:
        video = await self._get_video(video_id)
        return self._read(video)

    async def list_paginated(self, page: int, page_size: int) -> PaginatedResponse[VideoRead]:
        videos, total = await self._repo.list_paginated(page, page_size)
        return PaginatedResponse(
            items=[self._read(video) for video in videos],
            total=total,
            page=page,
            page_size=page_size,
        )

    async def update(self, video_id: uuid.UUID, data: VideoUpdate) -> VideoRead:
        video = await self._get_video(video_id)
        update_data = data.model_dump(exclude_unset=True)
        if "title" in update_data:
            video.title = update_data["title"]
        if "description" in update_data:
            video.description = update_data["description"]
        video = await self._repo.update(video)
        return self._read(video)

    async def delete(self, video_id: uuid.UUID) -> None:
        video = await self._get_video(video_id)
        object_key = video.object_key
        await self._repo.delete(video)
        self._storage.delete_video(object_key)

    async def _get_video(self, video_id: uuid.UUID) -> Video:
        video = await self._repo.get_by_id(video_id)
        if not video:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
        return video

    def _read(self, video: Video) -> VideoRead:
        data = VideoRead.model_validate(video)
        data.playback_url = self._storage.get_presigned_url(video.object_key)
        return data
