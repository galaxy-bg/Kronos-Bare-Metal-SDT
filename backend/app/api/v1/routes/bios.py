from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.bios.schemas import (
    BIOSCloneFromServerRequest,
    BIOSProfileApplyJobRead,
    BIOSProfileApplyRequest,
    BIOSProfileCompareRequest,
    BIOSProfileCreate,
    BIOSProfileRead,
    BIOSProfileUpdate,
    BIOSProfileValidateRequest,
)
from app.bios.service import BIOSProfileService
from app.db.session import get_db

router = APIRouter()


@router.get("/profiles", response_model=list[BIOSProfileRead])
def list_bios_profiles(db: Session = Depends(get_db)):
    return BIOSProfileService(db).list_profiles()


@router.post("/profiles", response_model=BIOSProfileRead, status_code=status.HTTP_201_CREATED)
def create_bios_profile(payload: BIOSProfileCreate, db: Session = Depends(get_db)):
    return BIOSProfileService(db).create_custom_profile(payload)


@router.post("/profiles/validate")
def validate_bios_profile(payload: BIOSProfileValidateRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    return BIOSProfileService(db).validate_attributes(payload.target_server_id, payload.attributes, payload.base_workload_profile)


@router.post("/profiles/clone-from-server", response_model=BIOSProfileRead, status_code=status.HTTP_201_CREATED)
def clone_bios_profile_from_server(payload: BIOSCloneFromServerRequest, db: Session = Depends(get_db)):
    return BIOSProfileService(db).clone_from_server(payload.server_id, payload.name, payload.base_workload_profile)


@router.get("/profiles/{profile_id}", response_model=BIOSProfileRead)
def get_bios_profile(profile_id: int, db: Session = Depends(get_db)):
    return BIOSProfileService(db).get_profile(profile_id)


@router.put("/profiles/{profile_id}", response_model=BIOSProfileRead)
def update_bios_profile(profile_id: int, payload: BIOSProfileUpdate, db: Session = Depends(get_db)):
    return BIOSProfileService(db).update_profile(profile_id, payload)


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bios_profile(profile_id: int, db: Session = Depends(get_db)):
    BIOSProfileService(db).delete_profile(profile_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/servers/{server_id}/current")
def get_server_bios_current(server_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return BIOSProfileService(db).current_for_server(server_id)


@router.get("/servers/{server_id}/workload-options")
def get_server_bios_workload_options(server_id: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    return BIOSProfileService(db).workload_options_for_server(server_id)


@router.post("/profiles/{profile_id}/compare")
def compare_bios_profile(profile_id: int, payload: BIOSProfileCompareRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    return BIOSProfileService(db).compare_profile(profile_id, payload.target_server_id)


@router.post("/profiles/{profile_id}/apply", response_model=BIOSProfileApplyJobRead, status_code=status.HTTP_201_CREATED)
def apply_bios_profile(profile_id: int, payload: BIOSProfileApplyRequest, db: Session = Depends(get_db)):
    return BIOSProfileService(db).apply_profile(profile_id, payload.target_server_id, payload.dry_run, payload.post_reboot)


@router.post("/profiles/{profile_id}/verify")
def verify_bios_profile(profile_id: int, payload: BIOSProfileCompareRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    return BIOSProfileService(db).verify_profile(profile_id, payload.target_server_id)
