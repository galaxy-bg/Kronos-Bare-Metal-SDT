"""bios profiles

Revision ID: 202607030001
Revises: 202607010001
Create Date: 2026-07-03 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607030001"
down_revision: str | Sequence[str] | None = "202607010001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bios_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("vendor", sa.String(length=64), nullable=False),
        sa.Column("server_model", sa.String(length=255), nullable=True),
        sa.Column("server_generation", sa.String(length=128), nullable=True),
        sa.Column("source_type", sa.String(length=64), nullable=False),
        sa.Column("source_server_id", sa.Integer(), nullable=True),
        sa.Column("base_workload_profile", sa.String(length=128), nullable=True),
        sa.Column("raw_attributes", sa.JSON(), nullable=False),
        sa.Column("normalized_attributes", sa.JSON(), nullable=False),
        sa.Column("custom_overrides", sa.JSON(), nullable=False),
        sa.Column("final_attributes", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("export_format", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["source_server_id"], ["servers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index(op.f("ix_bios_profiles_name"), "bios_profiles", ["name"], unique=False)
    op.create_index(op.f("ix_bios_profiles_source_server_id"), "bios_profiles", ["source_server_id"], unique=False)
    op.create_index(op.f("ix_bios_profiles_source_type"), "bios_profiles", ["source_type"], unique=False)
    op.create_index(op.f("ix_bios_profiles_vendor"), "bios_profiles", ["vendor"], unique=False)

    op.create_table(
        "bios_profile_apply_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("profile_id", sa.Integer(), nullable=False),
        sa.Column("target_server_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("diff_before_apply", sa.JSON(), nullable=False),
        sa.Column("previous_bios_backup", sa.JSON(), nullable=False),
        sa.Column("pending_reboot", sa.Boolean(), nullable=False),
        sa.Column("dry_run", sa.Boolean(), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("verification_result", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["profile_id"], ["bios_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_server_id"], ["servers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_bios_profile_apply_jobs_created_at"), "bios_profile_apply_jobs", ["created_at"], unique=False)
    op.create_index(op.f("ix_bios_profile_apply_jobs_profile_id"), "bios_profile_apply_jobs", ["profile_id"], unique=False)
    op.create_index(op.f("ix_bios_profile_apply_jobs_status"), "bios_profile_apply_jobs", ["status"], unique=False)
    op.create_index(
        op.f("ix_bios_profile_apply_jobs_target_server_id"),
        "bios_profile_apply_jobs",
        ["target_server_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_bios_profile_apply_jobs_target_server_id"), table_name="bios_profile_apply_jobs")
    op.drop_index(op.f("ix_bios_profile_apply_jobs_status"), table_name="bios_profile_apply_jobs")
    op.drop_index(op.f("ix_bios_profile_apply_jobs_profile_id"), table_name="bios_profile_apply_jobs")
    op.drop_index(op.f("ix_bios_profile_apply_jobs_created_at"), table_name="bios_profile_apply_jobs")
    op.drop_table("bios_profile_apply_jobs")
    op.drop_index(op.f("ix_bios_profiles_vendor"), table_name="bios_profiles")
    op.drop_index(op.f("ix_bios_profiles_source_type"), table_name="bios_profiles")
    op.drop_index(op.f("ix_bios_profiles_source_server_id"), table_name="bios_profiles")
    op.drop_index(op.f("ix_bios_profiles_name"), table_name="bios_profiles")
    op.drop_table("bios_profiles")
