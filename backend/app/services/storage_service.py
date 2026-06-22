from datetime import timedelta

from minio import Minio
from minio.datatypes import Part

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
        public_secure = (
            settings.minio_public_secure if settings.minio_public_secure is not None else settings.minio_secure
        )
        self._public_client = Minio(
            public_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=public_secure,
            region="us-east-1",
        )

    def ensure_bucket(self) -> None:
        if not self._client.bucket_exists(self._settings.minio_bucket):
            self._client.make_bucket(self._settings.minio_bucket)

    def get_presigned_url(self, object_key: str) -> str:
        return self._public_client.presigned_get_object(
            self._settings.minio_bucket,
            object_key,
            expires=timedelta(hours=2),
        )

    def create_multipart_upload(self, object_key: str, content_type: str) -> str:
        self.ensure_bucket()
        return self._client._create_multipart_upload(
            self._settings.minio_bucket,
            object_key,
            {"Content-Type": content_type},
        )

    def presign_upload_part(
        self,
        object_key: str,
        upload_id: str,
        part_number: int,
        expires: timedelta,
    ) -> str:
        return self._public_client.get_presigned_url(
            "PUT",
            self._settings.minio_bucket,
            object_key,
            expires=expires,
            extra_query_params={"partNumber": str(part_number), "uploadId": upload_id},
        )

    def complete_multipart_upload(
        self,
        object_key: str,
        upload_id: str,
        parts: list[tuple[int, str]],
    ) -> None:
        part_objs = [Part(part_number=number, etag=etag.strip('"')) for number, etag in parts]
        self._client._complete_multipart_upload(
            self._settings.minio_bucket,
            object_key,
            upload_id,
            part_objs,
        )

    def abort_multipart_upload(self, object_key: str, upload_id: str) -> None:
        self._client._abort_multipart_upload(
            self._settings.minio_bucket,
            object_key,
            upload_id,
        )

    def delete_video(self, object_key: str) -> None:
        self._client.remove_object(self._settings.minio_bucket, object_key)
