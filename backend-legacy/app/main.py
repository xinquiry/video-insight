from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.database import async_session_factory
from app.repositories.group_repo import GroupRepository
from app.repositories.user_repo import UserRepository
from app.services.admin_seed import ensure_admin_user


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    async with async_session_factory() as session:
        await ensure_admin_user(UserRepository(session), GroupRepository(session), settings)
    yield


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="VideoInsight API",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)

    return app
