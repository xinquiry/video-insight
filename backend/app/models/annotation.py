from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.video import Video


class Annotation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "annotations"

    video_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    timestamp_seconds: Mapped[float] = mapped_column(index=True)
    title: Mapped[str]
    body: Mapped[str]
    kind: Mapped[str] = mapped_column(default="note")
    color: Mapped[str] = mapped_column(default="#2563eb")
    custom_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

    video: Mapped[Video] = relationship(back_populates="annotations")
