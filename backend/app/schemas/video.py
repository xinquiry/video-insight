import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class VideoUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class VideoRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    group_id: uuid.UUID
    title: str
    description: str | None
    original_filename: str
    content_type: str
    size_bytes: int
    playback_url: str | None = None
    created_at: datetime
    updated_at: datetime | None


class UploadInitRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=512)
    content_type: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)


class UploadPartUrl(BaseModel):
    part_number: int
    url: str


class UploadInitResponse(BaseModel):
    object_key: str
    upload_id: str
    part_size: int
    parts: list[UploadPartUrl]
    expires_in: int


class UploadPartCompleted(BaseModel):
    part_number: int = Field(ge=1, le=10000)
    etag: str = Field(min_length=1, max_length=512)


class UploadCompleteRequest(BaseModel):
    object_key: str = Field(min_length=1)
    upload_id: str = Field(min_length=1)
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    filename: str = Field(min_length=1, max_length=512)
    content_type: str = Field(min_length=1, max_length=255)
    size_bytes: int = Field(gt=0)
    parts: list[UploadPartCompleted] = Field(min_length=1)


class UploadAbortRequest(BaseModel):
    object_key: str = Field(min_length=1)
    upload_id: str = Field(min_length=1)
