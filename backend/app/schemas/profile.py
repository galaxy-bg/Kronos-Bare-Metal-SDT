from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class ProfileRead(BaseModel):
    id: int
    name: str
    profile_type: str
    profile_json: dict[str, Any]

    model_config = ConfigDict(from_attributes=True)
