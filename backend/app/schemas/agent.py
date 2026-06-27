from typing import Any

from pydantic import BaseModel, ConfigDict


class AgentRegistration(BaseModel):
    serial_number: str
    vendor: str | None = None
    model: str | None = None
    product_name: str | None = None
    hostname: str | None = None
    agent_ip: str | None = None
    bmc_ip: str | None = None
    agent_version: str | None = None
    agent_build: str | None = None


class AgentHeartbeat(BaseModel):
    serial_number: str
    agent_ip: str | None = None
    agent_version: str | None = None
    agent_build: str | None = None


class AgentActionPoll(BaseModel):
    serial_number: str


class AgentActionRead(BaseModel):
    id: int
    action_type: str
    payload: dict[str, Any]


class AgentActionComplete(BaseModel):
    serial_number: str
    status: str
    result: dict[str, Any] | None = None
    error: str | None = None


class InventoryUpload(BaseModel):
    serial_number: str
    inventory: dict[str, Any]

    model_config = ConfigDict(json_schema_extra={
        "example": {
            "serial_number": "CZJ123456",
            "inventory": {
                "system": {"vendor": "HPE", "model": "ProLiant DL380 Gen11"},
                "cpu": [{"model": "Intel Xeon", "cores": 32}],
                "memory": {"total_gb": 256},
                "storage": [{"name": "sda", "size_gb": 960}],
                "network": [{"name": "eth0", "mac": "00:11:22:33:44:55"}],
                "bmc": {"vendor": "HPE", "type": "iLO", "ip": "10.10.10.15"},
            },
        }
    })
