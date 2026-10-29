"""add owner_id and meeting fields to items

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("items", sa.Column("owner_id", sa.String(length=255), nullable=True))
    op.add_column(
        "items",
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("items", sa.Column("duration_minutes", sa.Integer(), nullable=True))
    op.add_column("items", sa.Column("participants", sa.Integer(), nullable=True))
    op.add_column("items", sa.Column("agenda_items", postgresql.JSONB(), nullable=True))
    op.add_column("items", sa.Column("action_items", postgresql.JSONB(), nullable=True))
    op.create_index("ix_items_owner_id", "items", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_items_owner_id", table_name="items")
    op.drop_column("items", "action_items")
    op.drop_column("items", "agenda_items")
    op.drop_column("items", "participants")
    op.drop_column("items", "duration_minutes")
    op.drop_column("items", "start_time")
    op.drop_column("items", "owner_id")
