import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class VideoUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class VideoRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    title: str
    description: str | None
    original_filename: str
    content_type: str
    size_bytes: int
    playback_url: str | None = None
    created_at: datetime
    updated_at: datetime | None
