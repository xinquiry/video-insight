import uuid

from fastapi import APIRouter, File, Form, Query, UploadFile

from app.core.dependencies import CurrentSettings, CurrentUser, DbSession
from app.repositories.video_repo import VideoRepository
from app.schemas.common import PaginatedResponse
from app.schemas.video import VideoRead, VideoUpdate
from app.services.storage_service import StorageService
from app.services.video_service import VideoService

router = APIRouter(prefix="/videos")


def _build_service(session: DbSession, settings: CurrentSettings) -> VideoService:
    return VideoService(repo=VideoRepository(session), storage=StorageService(settings))


@router.get("", response_model=PaginatedResponse[VideoRead])
async def list_videos(
    session: DbSession,
    settings: CurrentSettings,
    current_user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    service = _build_service(session, settings)
    return await service.list_paginated(current_user.group_id, page, page_size)


@router.post("", response_model=VideoRead, status_code=201)
async def create_video(
    session: DbSession,
    settings: CurrentSettings,
    current_user: CurrentUser,
    title: str = Form(min_length=1, max_length=200),
    description: str | None = Form(default=None),
    file: UploadFile = File(),
):
    service = _build_service(session, settings)
    return await service.create(title, description, file, current_user.group_id)


@router.get("/{video_id}", response_model=VideoRead)
async def get_video(video_id: uuid.UUID, session: DbSession, settings: CurrentSettings, current_user: CurrentUser):
    service = _build_service(session, settings)
    return await service.get_by_id(video_id, current_user.group_id)


@router.patch("/{video_id}", response_model=VideoRead)
async def update_video(
    video_id: uuid.UUID,
    data: VideoUpdate,
    session: DbSession,
    settings: CurrentSettings,
    current_user: CurrentUser,
):
    service = _build_service(session, settings)
    return await service.update(video_id, current_user.group_id, data)


@router.delete("/{video_id}", status_code=204)
async def delete_video(video_id: uuid.UUID, session: DbSession, settings: CurrentSettings, current_user: CurrentUser):
    service = _build_service(session, settings)
    await service.delete(video_id, current_user.group_id)
