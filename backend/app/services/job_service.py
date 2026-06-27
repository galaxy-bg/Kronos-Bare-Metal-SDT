from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.server_action import ServerAction
from app.repositories.job_repository import JobRepository


class JobService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def enqueue(self, server_id: int, action_type: str, payload: dict) -> ServerAction:
        # TODO: job queue integration.
        action = JobRepository(self.db).create(server_id, action_type, payload)
        self.db.commit()
        self.db.refresh(action)
        return action
