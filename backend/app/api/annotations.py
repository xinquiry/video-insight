import uuid

from fastapi import APIRouter

from app.core.dependencies import CurrentUser, DbSession
from app.repositories.annotation_repo import AnnotationRepository
from app.repositories.video_repo import VideoRepository
from app.schemas.annotation import AnnotationCreate, AnnotationRead, AnnotationUpdate
from app.services.annotation_service import AnnotationService

router = APIRouter()


def _build_service(session: DbSession) -> AnnotationService:
    return AnnotationService(repo=AnnotationRepository(session), video_repo=VideoRepository(session))


@router.get("/videos/{video_id}/annotations", response_model=list[AnnotationRead])
async def list_annotations(video_id: uuid.UUID, session: DbSession, _current_user: CurrentUser):
    service = _build_service(session)
    return await service.list_for_video(video_id)


@router.post("/videos/{video_id}/annotations", response_model=AnnotationRead, status_code=201)
async def create_annotation(
    video_id: uuid.UUID,
    data: AnnotationCreate,
    session: DbSession,
    _current_user: CurrentUser,
):
    service = _build_service(session)
    return await service.create(video_id, data)


@router.patch("/annotations/{annotation_id}", response_model=AnnotationRead)
async def update_annotation(
    annotation_id: uuid.UUID,
    data: AnnotationUpdate,
    session: DbSession,
    _current_user: CurrentUser,
):
    service = _build_service(session)
    return await service.update(annotation_id, data)


@router.delete("/annotations/{annotation_id}", status_code=204)
async def delete_annotation(annotation_id: uuid.UUID, session: DbSession, _current_user: CurrentUser):
    service = _build_service(session)
    await service.delete(annotation_id)
