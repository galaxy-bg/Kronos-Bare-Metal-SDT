from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("")
def list_profiles() -> dict[str, str]:
    # TODO: BIOS profile apply and RAID profile apply.
    return {"status": "profile routes are reserved for Phase-2"}
