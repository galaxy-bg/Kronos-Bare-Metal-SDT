from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator


class IloUserActionRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    admin_username: str | None = Field(default=None, max_length=64)
    admin_password: str | None = Field(default=None, max_length=128)

    @field_validator("username", "password")
    @classmethod
    def strip_non_empty(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be empty")
        return stripped

    @field_validator("admin_username", "admin_password")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class IloNetworkActionRequest(BaseModel):
    ip: str = Field(min_length=1, max_length=64)
    subnet: str | None = Field(default=None, max_length=64)
    gateway: str | None = Field(default=None, max_length=64)
    dns: str | None = Field(default=None, max_length=255)
    ntp: str | None = Field(default=None, max_length=255)
    vlan: str | None = Field(default="0", max_length=32)
    admin_username: str | None = Field(default=None, max_length=64)
    admin_password: str | None = Field(default=None, max_length=128)

    @field_validator("ip")
    @classmethod
    def strip_ip(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("IP cannot be empty")
        return stripped

    @field_validator("subnet", "gateway", "dns", "ntp", "vlan", "admin_username", "admin_password")
    @classmethod
    def strip_optional(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class IloLicenseActionRequest(BaseModel):
    license_key: str = Field(min_length=1, max_length=256)
    admin_username: str | None = Field(default=None, max_length=64)
    admin_password: str | None = Field(default=None, max_length=128)

    @field_validator("license_key")
    @classmethod
    def strip_license_key(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("License key cannot be empty")
        return stripped

    @field_validator("admin_username", "admin_password")
    @classmethod
    def strip_optional_license_auth(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class RaidPlanRequest(BaseModel):
    disk_mode: str = Field(default="RAID", min_length=1, max_length=16)
    raid_level: str = Field(default="RAID1", min_length=1, max_length=16)
    purpose: str = Field(default="OS Boot", min_length=1, max_length=64)
    volume_name: str = Field(default="os-boot", min_length=1, max_length=64)
    selected_drive_paths: list[str] = Field(default_factory=list, min_length=1, max_length=32)
    bootable: bool = True
    initialize_as_jbod: bool = True

    @field_validator("disk_mode", "raid_level", "purpose", "volume_name")
    @classmethod
    def strip_required_raid_plan_values(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("Value cannot be empty")
        return stripped

    @field_validator("selected_drive_paths")
    @classmethod
    def strip_drive_paths(cls, value: list[str]) -> list[str]:
        paths = [item.strip() for item in value if item.strip()]
        if len(paths) != len(set(paths)):
            raise ValueError("Selected drives must be unique")
        if not paths:
            raise ValueError("At least one drive must be selected")
        return paths


class IloEnrollmentCreateResponse(BaseModel):
    token: str
    url: str
    expires_at: datetime


class IloEnrollmentRead(BaseModel):
    server_id: int
    serial_number: str
    hostname: str | None = None
    vendor: str | None = None
    model: str | None = None
    expires_at: datetime


class IloEnrollmentSubmit(BaseModel):
    username: str = Field(default="Administrator", min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    dns_name: str | None = Field(default=None, max_length=255)
    create_managed_user: bool = True

    @field_validator("username", "password", "dns_name")
    @classmethod
    def strip_values(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped and value is not None:
            return None
        return stripped


class ServerActionRead(BaseModel):
    id: int
    server_id: int
    action_type: str
    status: str
    payload_json: dict[str, Any]
    result_json: dict[str, Any] | None = None
    error_message: str | None = None
    requested_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
