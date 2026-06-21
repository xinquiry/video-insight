"""add groups

Revision ID: 202606220001
Revises: 202606210001
Create Date: 2026-06-22 00:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "202606220001"
down_revision: str | None = "202606210001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "groups",
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_groups_name"), "groups", ["name"], unique=True)
    op.execute("INSERT INTO groups (name) VALUES ('Default') ON CONFLICT (name) DO NOTHING")

    op.add_column("users", sa.Column("group_id", sa.UUID(), nullable=True))
    op.add_column("videos", sa.Column("group_id", sa.UUID(), nullable=True))
    op.execute("UPDATE users SET group_id = (SELECT id FROM groups WHERE name = 'Default')")
    op.execute("UPDATE videos SET group_id = (SELECT id FROM groups WHERE name = 'Default')")
    op.alter_column("users", "group_id", nullable=False)
    op.alter_column("videos", "group_id", nullable=False)

    op.create_index(op.f("ix_users_group_id"), "users", ["group_id"], unique=False)
    op.create_index(op.f("ix_videos_group_id"), "videos", ["group_id"], unique=False)
    op.create_foreign_key(op.f("fk_users_group_id_groups"), "users", "groups", ["group_id"], ["id"])
    op.create_foreign_key(op.f("fk_videos_group_id_groups"), "videos", "groups", ["group_id"], ["id"])


def downgrade() -> None:
    op.drop_constraint(op.f("fk_videos_group_id_groups"), "videos", type_="foreignkey")
    op.drop_constraint(op.f("fk_users_group_id_groups"), "users", type_="foreignkey")
    op.drop_index(op.f("ix_videos_group_id"), table_name="videos")
    op.drop_index(op.f("ix_users_group_id"), table_name="users")
    op.drop_column("videos", "group_id")
    op.drop_column("users", "group_id")
    op.drop_index(op.f("ix_groups_name"), table_name="groups")
    op.drop_table("groups")
