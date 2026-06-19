import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AnnotationCreate(BaseModel):
    timestamp_seconds: float = Field(ge=0)
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1)
    kind: str = Field(default="note", min_length=1, max_length=60)
    color: str = Field(default="#2563eb", pattern=r"^#[0-9a-fA-F]{6}$")
    custom_data: dict[str, Any] = Field(default_factory=dict)


class AnnotationUpdate(BaseModel):
    timestamp_seconds: float | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=200)
    body: str | None = Field(default=None, min_length=1)
    kind: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    custom_data: dict[str, Any] | None = None


class AnnotationRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    video_id: uuid.UUID
    timestamp_seconds: float
    title: str
    body: str
    kind: str
    color: str
    custom_data: dict[str, Any]
    created_at: datetime
    updated_at: datetime | None
