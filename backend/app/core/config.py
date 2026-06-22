from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+asyncpg://videoinsight:videoinsight@localhost:5432/videoinsight"
    cors_origins: list[str] = ["http://localhost:5173"]
    secret_key: str = "dev-secret-change-me"  # noqa: S105
    access_token_expire_minutes: int = 60 * 24
    admin_username: str = "admin"
    admin_password: str = "admin"  # noqa: S105
    default_group_name: str = "Default"
    minio_endpoint: str = "localhost:9000"
    minio_public_endpoint: str | None = None
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"  # noqa: S105
    minio_bucket: str = "videos"
    minio_secure: bool = False
    minio_public_secure: bool | None = None
    minio_region: str = "us-east-1"
    upload_part_size_bytes: int = 5 * 1024 * 1024
    upload_url_expires_seconds: int = 60 * 60 * 6
    upload_max_parts: int = 10000
    upload_concurrency: int = 1


@lru_cache
def get_settings() -> Settings:
    return Settings()
