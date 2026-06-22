import math
import uuid
from contextlib import suppress
from datetime import timedelta

from fastapi import HTTPException, status

from app.core.config import Settings
from app.models.video import Video
from app.repositories.video_repo import VideoRepository
from app.schemas.common import PaginatedResponse
from app.schemas.video import (
    UploadCompleteRequest,
    UploadInitRequest,
    UploadInitResponse,
    UploadPartUrl,
    VideoRead,
    VideoUpdate,
)
from app.services.storage_service import StorageService


class VideoService:
    def __init__(self, repo: VideoRepository, storage: StorageService, settings: Settings):
        self._repo = repo
        self._storage = storage
        self._settings = settings

    async def init_upload(self, payload: UploadInitRequest) -> UploadInitResponse:
        if not payload.content_type.startswith("video/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file must be a video",
            )

        part_size = self._settings.upload_part_size_bytes
        max_parts = self._settings.upload_max_parts
        part_count = max(1, math.ceil(payload.size_bytes / part_size))
        if part_count > max_parts:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"File would require {part_count} parts (limit {max_parts})",
            )

        safe_name = (payload.filename or "video").replace("/", "_")
        object_key = f"videos/{uuid.uuid4()}-{safe_name}"
        upload_id = self._storage.create_multipart_upload(object_key, payload.content_type)
        expires = timedelta(seconds=self._settings.upload_url_expires_seconds)

        parts = [
            UploadPartUrl(
                part_number=part_number,
                url=self._storage.presign_upload_part(object_key, upload_id, part_number, expires),
            )
            for part_number in range(1, part_count + 1)
        ]

        return UploadInitResponse(
            object_key=object_key,
            upload_id=upload_id,
            part_size=part_size,
            parts=parts,
            expires_in=int(expires.total_seconds()),
        )

    async def complete_upload(self, payload: UploadCompleteRequest, group_id: uuid.UUID) -> VideoRead:
        if not payload.content_type.startswith("video/"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file must be a video",
            )
        if not payload.object_key.startswith("videos/"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid object key")

        ordered = sorted(((p.part_number, p.etag) for p in payload.parts), key=lambda item: item[0])
        try:
            self._storage.complete_multipart_upload(payload.object_key, payload.upload_id, ordered)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to finalize upload: {exc}",
            ) from exc

        try:
            video = Video(
                title=payload.title,
                description=payload.description,
                group_id=group_id,
                object_key=payload.object_key,
                original_filename=payload.filename,
                content_type=payload.content_type,
                size_bytes=payload.size_bytes,
            )
            video = await self._repo.create(video)
        except Exception:
            with suppress(Exception):
                self._storage.delete_video(payload.object_key)
            raise
        return self._read(video)

    async def abort_upload(self, object_key: str, upload_id: str) -> None:
        if not object_key.startswith("videos/"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid object key")
        with suppress(Exception):
            self._storage.abort_multipart_upload(object_key, upload_id)

    async def get_by_id(self, video_id: uuid.UUID, group_id: uuid.UUID) -> VideoRead:
        video = await self._get_video(video_id, group_id)
        return self._read(video)

    async def list_paginated(self, group_id: uuid.UUID, page: int, page_size: int) -> PaginatedResponse[VideoRead]:
        videos, total = await self._repo.list_paginated(group_id, page, page_size)
        return PaginatedResponse(
            items=[self._read(video) for video in videos],
            total=total,
            page=page,
            page_size=page_size,
        )

    async def update(self, video_id: uuid.UUID, group_id: uuid.UUID, data: VideoUpdate) -> VideoRead:
        video = await self._get_video(video_id, group_id)
        update_data = data.model_dump(exclude_unset=True)
        if "title" in update_data:
            video.title = update_data["title"]
        if "description" in update_data:
            video.description = update_data["description"]
        video = await self._repo.update(video)
        return self._read(video)

    async def delete(self, video_id: uuid.UUID, group_id: uuid.UUID) -> None:
        video = await self._get_video(video_id, group_id)
        object_key = video.object_key
        await self._repo.delete(video)
        self._storage.delete_video(object_key)

    async def _get_video(self, video_id: uuid.UUID, group_id: uuid.UUID) -> Video:
        video = await self._repo.get_by_id_for_group(video_id, group_id)
        if not video:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video not found")
        return video

    def _read(self, video: Video) -> VideoRead:
        data = VideoRead.model_validate(video)
        data.playback_url = self._storage.get_presigned_url(video.object_key)
        return data
