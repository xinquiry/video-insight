from fastapi import APIRouter

from app.api.annotations import router as annotations_router
from app.api.auth import router as auth_router
from app.api.groups import router as groups_router
from app.api.health import router as health_router
from app.api.videos import router as videos_router

api_router = APIRouter(prefix="/api")
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, tags=["auth"])
api_router.include_router(groups_router, tags=["groups"])
api_router.include_router(videos_router, tags=["videos"])
api_router.include_router(annotations_router, tags=["annotations"])
