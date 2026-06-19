from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://videoinsight:videoinsight@localhost:5432/videoinsight"
    cors_origins: list[str] = ["http://localhost:5173"]
    secret_key: str = "dev-secret-change-me"  # noqa: S105
    access_token_expire_minutes: int = 60 * 24
    minio_endpoint: str = "localhost:9000"
    minio_public_endpoint: str | None = None
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"  # noqa: S105
    minio_bucket: str = "videos"
    minio_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
