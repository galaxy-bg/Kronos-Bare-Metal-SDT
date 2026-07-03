from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class BIOSProfile(Base):
    __tablename__ = "bios_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    vendor: Mapped[str] = mapped_column(String(64), default="hpe", index=True)
    server_model: Mapped[str | None] = mapped_column(String(255))
    server_generation: Mapped[str | None] = mapped_column(String(128))
    source_type: Mapped[str] = mapped_column(String(64), default="custom", index=True)
    source_server_id: Mapped[int | None] = mapped_column(ForeignKey("servers.id", ondelete="SET NULL"), index=True)
    base_workload_profile: Mapped[str | None] = mapped_column(String(128))
    raw_attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    normalized_attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    custom_overrides: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    final_attributes: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    export_format: Mapped[str] = mapped_column(String(16), default="json")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    source_server = relationship("Server")
    apply_jobs: Mapped[list["BIOSProfileApplyJob"]] = relationship(
        back_populates="profile",
        cascade="all, delete-orphan",
        order_by="desc(BIOSProfileApplyJob.created_at)",
    )


class BIOSProfileApplyJob(Base):
    __tablename__ = "bios_profile_apply_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("bios_profiles.id", ondelete="CASCADE"), index=True)
    target_server_id: Mapped[int] = mapped_column(ForeignKey("servers.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="dry_run", index=True)
    diff_before_apply: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    previous_bios_backup: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    pending_reboot: Mapped[bool] = mapped_column(default=False)
    dry_run: Mapped[bool] = mapped_column(default=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    profile: Mapped[BIOSProfile] = relationship(back_populates="apply_jobs")
    target_server = relationship("Server")
