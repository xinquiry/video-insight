from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.annotation import Annotation
from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Video(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "videos"

    title: Mapped[str] = mapped_column(index=True)
    description: Mapped[str | None]
    object_key: Mapped[str] = mapped_column(unique=True)
    original_filename: Mapped[str]
    content_type: Mapped[str]
    size_bytes: Mapped[int]

    annotations: Mapped[list["Annotation"]] = relationship(
        back_populates="video",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
