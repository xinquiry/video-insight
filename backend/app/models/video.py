from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.annotation import Annotation
from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.group import Group


class Video(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "videos"

    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id"), index=True)
    title: Mapped[str] = mapped_column(index=True)
    description: Mapped[str | None]
    object_key: Mapped[str] = mapped_column(unique=True)
    original_filename: Mapped[str]
    content_type: Mapped[str]
    size_bytes: Mapped[int]

    group: Mapped[Group] = relationship(back_populates="videos")
    annotations: Mapped[list[Annotation]] = relationship(
        back_populates="video",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
