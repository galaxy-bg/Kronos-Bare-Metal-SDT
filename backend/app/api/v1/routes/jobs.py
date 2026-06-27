from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_jobs() -> dict[str, str]:
    # TODO: job queue integration.
    return {"status": "job routes are reserved for Phase-2"}
