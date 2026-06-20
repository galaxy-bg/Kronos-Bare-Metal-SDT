"""initial schema

Revision ID: 202606210001
Revises:
Create Date: 2026-06-21 00:01:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "202606210001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "servers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("serial_number", sa.String(length=128), nullable=False),
        sa.Column("vendor", sa.String(length=128), nullable=True),
        sa.Column("model", sa.String(length=255), nullable=True),
        sa.Column("product_name", sa.String(length=255), nullable=True),
        sa.Column("hostname", sa.String(length=255), nullable=True),
        sa.Column("agent_ip", sa.String(length=64), nullable=True),
        sa.Column("bmc_ip", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="online"),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("serial_number", name="uq_servers_serial_number"),
        sa.UniqueConstraint("uuid", name="uq_servers_uuid"),
    )
    op.create_index("ix_servers_status", "servers", ["status"])
    op.create_index("ix_servers_last_seen", "servers", ["last_seen"])

    op.create_table(
        "inventories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("server_id", sa.Integer(), nullable=False),
        sa.Column("inventory_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["server_id"], ["servers.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_inventories_server_id", "inventories", ["server_id"])


def downgrade() -> None:
    op.drop_index("ix_inventories_server_id", table_name="inventories")
    op.drop_table("inventories")
    op.drop_index("ix_servers_last_seen", table_name="servers")
    op.drop_index("ix_servers_status", table_name="servers")
    op.drop_table("servers")
