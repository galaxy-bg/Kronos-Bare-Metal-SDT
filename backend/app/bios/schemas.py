from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class BIOSProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    vendor: str = Field(default="hpe", min_length=1, max_length=64)
    server_model: str | None = Field(default=None, max_length=255)
    server_generation: str | None = Field(default=None, max_length=128)
    source_type: str = Field(default="custom", max_length=64)
    source_server_id: int | None = None
    base_workload_profile: str | None = Field(default=None, max_length=128)
    raw_attributes: dict[str, Any] = Field(default_factory=dict)
    normalized_attributes: dict[str, Any] = Field(default_factory=dict)
    custom_overrides: dict[str, Any] = Field(default_factory=dict)

    @field_validator("name", "vendor", "server_model", "server_generation", "source_type", "base_workload_profile")
    @classmethod
    def strip_strings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class BIOSProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    vendor: str | None = Field(default=None, min_length=1, max_length=64)
    server_model: str | None = Field(default=None, max_length=255)
    server_generation: str | None = Field(default=None, max_length=128)
    base_workload_profile: str | None = Field(default=None, max_length=128)
    normalized_attributes: dict[str, Any] | None = None
    custom_overrides: dict[str, Any] | None = None

    @field_validator("name", "vendor", "server_model", "server_generation", "base_workload_profile")
    @classmethod
    def strip_strings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class BIOSCloneFromServerRequest(BaseModel):
    server_id: int
    name: str = Field(min_length=1, max_length=128)
    base_workload_profile: str | None = Field(default=None, max_length=128)

    @field_validator("name", "base_workload_profile")
    @classmethod
    def strip_strings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class BIOSProfileCompareRequest(BaseModel):
    target_server_id: int


class BIOSProfileApplyRequest(BaseModel):
    target_server_id: int
    dry_run: bool = True
    post_reboot: bool = False
    confirmation: str = Field(default="confirm", min_length=1, max_length=32)

    @field_validator("confirmation")
    @classmethod
    def require_confirm(cls, value: str) -> str:
        stripped = value.strip().lower()
        if stripped != "confirm":
            raise ValueError("Type confirm to apply BIOS profile")
        return stripped


class BIOSProfileRead(BaseModel):
    id: int
    name: str
    vendor: str
    server_model: str | None = None
    server_generation: str | None = None
    source_type: str
    source_server_id: int | None = None
    base_workload_profile: str | None = None
    raw_attributes: dict[str, Any]
    normalized_attributes: dict[str, Any]
    custom_overrides: dict[str, Any]
    final_attributes: dict[str, Any]
    metadata_json: dict[str, Any]
    export_format: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class BIOSProfileValidateRequest(BaseModel):
    target_server_id: int
    base_workload_profile: str | None = Field(default=None, max_length=128)
    attributes: dict[str, Any] = Field(default_factory=dict)


class BIOSProfileApplyJobRead(BaseModel):
    id: int
    profile_id: int
    target_server_id: int
    status: str
    diff_before_apply: dict[str, Any]
    previous_bios_backup: dict[str, Any]
    pending_reboot: bool
    dry_run: bool
    applied_at: datetime | None = None
    verified_at: datetime | None = None
    verification_result: dict[str, Any] | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
