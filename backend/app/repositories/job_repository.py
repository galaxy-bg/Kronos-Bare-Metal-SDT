from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.server_action import ServerAction


class JobRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, server_id: int, action_type: str, payload: dict) -> ServerAction:
        # TODO: job queue integration.
        action = ServerAction(server_id=server_id, action_type=action_type, payload_json=payload)
        self.db.add(action)
        return action
