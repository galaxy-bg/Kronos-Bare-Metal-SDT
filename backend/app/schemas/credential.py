from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class CredentialRead(BaseModel):
    id: int
    server_id: int
    username: str
    credential_type: str

    model_config = ConfigDict(from_attributes=True)
