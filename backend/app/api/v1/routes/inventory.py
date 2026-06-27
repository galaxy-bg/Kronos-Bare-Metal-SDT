from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_inventory() -> dict[str, str]:
    return {"status": "inventory routes are reserved for Phase-2"}
