from app.core.config import Settings
from app.core.security import hash_password
from app.models.group import Group
from app.models.user import User
from app.repositories.group_repo import GroupRepositoryProtocol
from app.repositories.user_repo import UserRepositoryProtocol


async def ensure_admin_user(
    user_repo: UserRepositoryProtocol,
    group_repo: GroupRepositoryProtocol,
    settings: Settings,
) -> User:
    group = await group_repo.get_by_name(settings.default_group_name)
    if group is None:
        group = await group_repo.create(Group(name=settings.default_group_name))

    user = await user_repo.get_by_username(settings.admin_username)
    password_hash = hash_password(settings.admin_password)

    if user is None:
        return await user_repo.create(
            User(
                username=settings.admin_username,
                password_hash=password_hash,
                group_id=group.id,
                is_admin=True,
            )
        )

    user.password_hash = password_hash
    user.group_id = group.id
    user.is_admin = True
    return await user_repo.save(user)
