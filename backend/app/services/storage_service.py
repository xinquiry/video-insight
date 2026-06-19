from datetime import timedelta
from typing import BinaryIO

from minio import Minio

from app.core.config import Settings


class StorageService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._client = Minio(
            settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
        )
        public_endpoint = settings.minio_public_endpoint or settings.minio_endpoint
        self._public_client = Minio(
            public_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_secure,
            region="us-east-1",
        )

    def ensure_bucket(self) -> None:
        if not self._client.bucket_exists(self._settings.minio_bucket):
            self._client.make_bucket(self._settings.minio_bucket)

    def upload_video(
        self,
        object_key: str,
        file: BinaryIO,
        size: int,
        content_type: str,
    ) -> None:
        self.ensure_bucket()
        self._client.put_object(
            self._settings.minio_bucket,
            object_key,
            file,
            length=size,
            content_type=content_type,
        )

    def get_presigned_url(self, object_key: str) -> str:
        return self._public_client.presigned_get_object(
            self._settings.minio_bucket,
            object_key,
            expires=timedelta(hours=2),
        )

    def delete_video(self, object_key: str) -> None:
        self._client.remove_object(self._settings.minio_bucket, object_key)
