"""add management network config

Revision ID: 202606210002
Revises: 202606210001
Create Date: 2026-06-21 23:35:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606210002"
down_revision: str | None = "202606210001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("servers", sa.Column("management_config_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("servers", "management_config_json")
