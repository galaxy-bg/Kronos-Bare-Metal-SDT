"""add credential placeholder table

Revision ID: 202606270001
Revises: 202606230001
Create Date: 2026-06-27 11:30:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202606270001"
down_revision: str | None = "202606230001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE servers
        SET vendor = 'hpe'
        WHERE lower(coalesce(vendor, '')) IN (
            'hpe',
            'hp',
            'hewlett packard enterprise',
            'hewlett-packard',
            'hewlett-packard enterprise'
        )
        """
    )
    op.execute(
        """
        UPDATE servers
        SET vendor = 'dell'
        WHERE lower(coalesce(vendor, '')) IN (
            'dell',
            'dell inc.',
            'dell emc',
            'dell technologies'
        )
        """
    )
    op.execute(
        """
        UPDATE servers
        SET vendor = 'oem'
        WHERE lower(coalesce(vendor, '')) LIKE '%pegatron%'
        """
    )
    op.create_table(
        "credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("server_id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=128), nullable=False),
        sa.Column("encrypted_password", sa.String(length=2048), nullable=False),
        sa.Column("credential_type", sa.String(length=32), nullable=False, server_default="bmc"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_credentials_server_id", "credentials", ["server_id"])
    op.create_index("ix_credentials_credential_type", "credentials", ["credential_type"])


def downgrade() -> None:
    op.drop_index("ix_credentials_credential_type", table_name="credentials")
    op.drop_index("ix_credentials_server_id", table_name="credentials")
    op.drop_table("credentials")
