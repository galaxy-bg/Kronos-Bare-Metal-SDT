from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.global_setting import GlobalSetting

router = APIRouter()

DEFAULT_SETTINGS: dict[str, Any] = {
    "task_footer": {
        "enabled": True,
        "active_refresh_seconds": 4,
        "idle_refresh_seconds": 30,
        "running_timeout_minutes": 10,
        "completed_visible_minutes": 10,
    },
    "provisioning": {
        "controller_url": "http://192.168.88.240:8000",
        "default_agent_interface": "",
        "default_ilo_user": "hpadmin",
        "storage_executor": "agent",
    },
    "storage": {
        "enable_destructive_raid_actions": False,
        "auto_jbod_remaining": True,
        "prefer_agent_storage": True,
    },
}


class GlobalSettingsUpdate(BaseModel):
    settings: dict[str, Any] = Field(default_factory=dict)


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def settings_record(db: Session) -> GlobalSetting:
    record = db.get(GlobalSetting, "global")
    if record is None:
        record = GlobalSetting(key="global", value_json=DEFAULT_SETTINGS)
        db.add(record)
        db.commit()
        db.refresh(record)
    return record


@router.get("")
def get_global_settings(db: Session = Depends(get_db)) -> dict[str, Any]:
    record = settings_record(db)
    return {"settings": deep_merge(DEFAULT_SETTINGS, record.value_json or {}), "updated_at": record.updated_at}


@router.put("")
def update_global_settings(payload: GlobalSettingsUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    record = settings_record(db)
    record.value_json = deep_merge(DEFAULT_SETTINGS, payload.settings)
    record.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(record)
    return {"settings": record.value_json, "updated_at": record.updated_at}
