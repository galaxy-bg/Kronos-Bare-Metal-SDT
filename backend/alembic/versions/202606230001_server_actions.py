"""add server action queue

Revision ID: 202606230001
Revises: 202606210002
Create Date: 2026-06-23 21:10:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606230001"
down_revision: str | None = "202606210002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "server_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("server_id", sa.Integer(), nullable=False),
        sa.Column("action_type", sa.String(length=96), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_server_actions_server_id", "server_actions", ["server_id"])
    op.create_index("ix_server_actions_action_type", "server_actions", ["action_type"])
    op.create_index("ix_server_actions_status", "server_actions", ["status"])
    op.create_index("ix_server_actions_requested_at", "server_actions", ["requested_at"])


def downgrade() -> None:
    op.drop_index("ix_server_actions_requested_at", table_name="server_actions")
    op.drop_index("ix_server_actions_status", table_name="server_actions")
    op.drop_index("ix_server_actions_action_type", table_name="server_actions")
    op.drop_index("ix_server_actions_server_id", table_name="server_actions")
    op.drop_table("server_actions")
