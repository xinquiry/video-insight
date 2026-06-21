from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.core.config import Settings
from app.core.dependencies import get_current_admin_user
from app.core.security import verify_password
from app.models.group import Group
from app.models.user import User
from app.schemas.auth import UserCreate, UserLogin
from app.services.admin_seed import ensure_admin_user
from app.services.auth_service import AuthService


class FakeUserRepository:
    def __init__(self):
        self.users: dict[str, User] = {}

    async def create(self, user: User) -> User:
        if user.username in self.users:
            raise IntegrityError("", {}, Exception("duplicate username"))
        self._hydrate(user)
        self.users[user.username] = user
        return user

    async def save(self, user: User) -> User:
        self._hydrate(user)
        self.users[user.username] = user
        return user

    async def get_by_id(self, user_id):
        return next((user for user in self.users.values() if user.id == user_id), None)

    async def get_by_username(self, username: str) -> User | None:
        return self.users.get(username)

    def _hydrate(self, user: User) -> None:
        user.id = user.id or uuid4()
        user.created_at = user.created_at or datetime.now(UTC).replace(tzinfo=None)


class FakeGroupRepository:
    def __init__(self):
        self.groups: dict[str, Group] = {}

    async def create(self, group: Group) -> Group:
        if group.name in self.groups:
            raise IntegrityError("", {}, Exception("duplicate group"))
        self._hydrate(group)
        self.groups[group.name] = group
        return group

    async def get_by_id(self, group_id):
        return next((group for group in self.groups.values() if group.id == group_id), None)

    async def get_by_name(self, name: str) -> Group | None:
        return self.groups.get(name)

    async def list_all(self) -> list[Group]:
        return list(self.groups.values())

    def _hydrate(self, group: Group) -> None:
        group.id = group.id or uuid4()
        group.created_at = group.created_at or datetime.now(UTC).replace(tzinfo=None)


async def create_group(repo: FakeGroupRepository, name: str = "Default") -> Group:
    return await repo.create(Group(name=name))


@pytest.mark.asyncio
async def test_create_user_hashes_password_and_never_creates_admin():
    repo = FakeUserRepository()
    group_repo = FakeGroupRepository()
    group = await create_group(group_repo)
    service = AuthService(repo=repo, settings=Settings(secret_key="test-secret"), group_repo=group_repo)

    created = await service.create_user(
        UserCreate(username="student", password="password123", group_id=group.id)
    )

    user = repo.users["student"]
    assert created.username == "student"
    assert created.group_id == group.id
    assert created.is_admin is False
    assert user.is_admin is False
    assert user.password_hash != "password123"  # noqa: S105
    assert verify_password("password123", user.password_hash)


@pytest.mark.asyncio
async def test_create_user_rejects_duplicate_username():
    repo = FakeUserRepository()
    group_repo = FakeGroupRepository()
    group = await create_group(group_repo)
    service = AuthService(repo=repo, settings=Settings(secret_key="test-secret"), group_repo=group_repo)
    data = UserCreate(username="student", password="password123", group_id=group.id)

    await service.create_user(data)
    with pytest.raises(HTTPException) as exc_info:
        await service.create_user(data)

    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_login_uses_hashed_password_and_includes_admin_flag():
    repo = FakeUserRepository()
    group_repo = FakeGroupRepository()
    settings = Settings(secret_key="test-secret")
    service = AuthService(repo=repo, settings=settings)
    admin = await ensure_admin_user(
        repo,
        group_repo,
        Settings(secret_key="test-secret", admin_username="admin", admin_password="admin-password"),
    )

    token = await service.login(UserLogin(username="admin", password="admin-password"))

    assert admin.is_admin is True
    assert admin.group_id == group_repo.groups["Default"].id
    assert token.user.username == "admin"
    assert token.user.group_id == admin.group_id
    assert token.user.is_admin is True
    assert token.access_token


@pytest.mark.asyncio
async def test_login_rejects_bad_password():
    repo = FakeUserRepository()
    group_repo = FakeGroupRepository()
    group = await create_group(group_repo)
    service = AuthService(repo=repo, settings=Settings(secret_key="test-secret"), group_repo=group_repo)
    await service.create_user(UserCreate(username="student", password="password123", group_id=group.id))

    with pytest.raises(HTTPException) as exc_info:
        await service.login(UserLogin(username="student", password="wrong-password"))

    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_seeded_admin_is_controlled_by_env_settings():
    repo = FakeUserRepository()
    group_repo = FakeGroupRepository()
    settings = Settings(secret_key="test-secret", admin_username="owner", admin_password="first-password")

    admin = await ensure_admin_user(repo, group_repo, settings)
    assert admin.username == "owner"
    assert admin.group_id == group_repo.groups["Default"].id
    assert admin.is_admin is True
    assert verify_password("first-password", admin.password_hash)

    settings.admin_password = "second-password"  # noqa: S105
    updated = await ensure_admin_user(repo, group_repo, settings)
    assert updated.id == admin.id
    assert updated.is_admin is True
    assert verify_password("second-password", updated.password_hash)


@pytest.mark.asyncio
async def test_admin_dependency_rejects_non_admin_user():
    user = User(username="student", password_hash="hash", group_id=uuid4(), is_admin=False)

    with pytest.raises(HTTPException) as exc_info:
        await get_current_admin_user(user)

    assert exc_info.value.status_code == 403
