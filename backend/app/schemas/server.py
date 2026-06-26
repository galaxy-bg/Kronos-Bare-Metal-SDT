from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class InventoryRead(BaseModel):
    id: int
    inventory_json: dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ServerRead(BaseModel):
    id: int
    uuid: str
    serial_number: str
    vendor: str | None
    model: str | None
    product_name: str | None
    hostname: str | None
    agent_ip: str | None
    bmc_ip: str | None
    management_config_json: dict[str, Any] | None = None
    latest_inventory_json: dict[str, Any] | None = None
    registration_status: str = "registered"
    readiness_status: str = "registered"
    readiness_reasons: list[str] = Field(default_factory=list)
    conflicts: dict[str, Any] = Field(default_factory=dict)
    agent_reachable: bool | None = None
    bmc_reachable: bool | None = None
    status: str
    last_seen: datetime
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ServerDetail(ServerRead):
    inventories: list[InventoryRead] = Field(default_factory=list)


class ServerUpdate(BaseModel):
    vendor: str | None = None
    model: str | None = None
    product_name: str | None = None
    hostname: str | None = None
    agent_ip: str | None = None
    bmc_ip: str | None = None
    management_config_json: dict[str, Any] | None = None
    status: str | None = None


class BulkDeleteRequest(BaseModel):
    server_ids: list[int] = Field(min_length=1, max_length=200)


class BulkDeleteResponse(BaseModel):
    deleted: int
    requested: int


class DashboardStats(BaseModel):
    total_servers: int
    online_servers: int
    offline_servers: int
