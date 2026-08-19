import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=256)
    group_id: uuid.UUID


class UserLogin(BaseModel):
    username: str
    password: str


class UserRead(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    group_id: uuid.UUID
    username: str
    is_admin: bool
    created_at: datetime


class TokenRead(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105
    user: UserRead
