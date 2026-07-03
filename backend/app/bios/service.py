from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.bios.diff import compliance_result, diff_attributes
from app.bios.normalizer import final_attributes, normalize_bios_config
from app.bios.vendors.hpe_redfish import HpeRedfishBIOSClient
from app.models.global_setting import GlobalSetting
from app.models.bios_profile import BIOSProfile, BIOSProfileApplyJob
from app.models.server import Server
from app.utils.dmi import normalize_vendor
from app.utils.redfish import RedfishError


class BIOSProfileService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.hpe_client = HpeRedfishBIOSClient()

    def list_profiles(self) -> list[BIOSProfile]:
        return self.db.query(BIOSProfile).order_by(BIOSProfile.updated_at.desc()).all()

    def get_profile(self, profile_id: int) -> BIOSProfile:
        profile = self.db.get(BIOSProfile, profile_id)
        if profile is None:
            raise HTTPException(status_code=404, detail="BIOS profile not found")
        return profile

    def create_custom_profile(self, payload: Any) -> BIOSProfile:
        normalized = dict(payload.normalized_attributes or {})
        overrides = dict(payload.custom_overrides or {})
        profile = BIOSProfile(
            name=payload.name,
            vendor=payload.vendor,
            server_model=payload.server_model,
            server_generation=payload.server_generation,
            source_type="custom",
            base_workload_profile=payload.base_workload_profile,
            raw_attributes=dict(payload.raw_attributes or {}),
            normalized_attributes=normalized,
            custom_overrides=overrides,
            final_attributes=final_attributes(normalized, overrides, payload.base_workload_profile),
            metadata_json={"source": "custom"},
            export_format="json",
        )
        self.db.add(profile)
        self.db.commit()
        self.db.refresh(profile)
        return profile

    def update_profile(self, profile_id: int, payload: Any) -> BIOSProfile:
        profile = self.get_profile(profile_id)
        for field in ("name", "vendor", "server_model", "server_generation", "base_workload_profile"):
            value = getattr(payload, field, None)
            if value is not None:
                setattr(profile, field, value)
        if payload.normalized_attributes is not None:
            profile.normalized_attributes = dict(payload.normalized_attributes)
        if payload.custom_overrides is not None:
            profile.custom_overrides = dict(payload.custom_overrides)
        profile.final_attributes = final_attributes(
            profile.normalized_attributes,
            profile.custom_overrides,
            profile.base_workload_profile,
        )
        profile.updated_at = datetime.now(UTC)
        self.db.commit()
        self.db.refresh(profile)
        return profile

    def delete_profile(self, profile_id: int) -> None:
        profile = self.get_profile(profile_id)
        self.db.delete(profile)
        self.db.commit()

    def clone_from_server(self, server_id: int, name: str, base_workload_profile: str | None = None) -> BIOSProfile:
        server = self._server(server_id)
        bios_payload = self._read_current(server)
        normalized = normalize_bios_config(bios_payload)
        workload = base_workload_profile or normalized.get("workload_profile")
        profile = BIOSProfile(
            name=name,
            vendor=normalize_vendor(server.vendor),
            server_model=server.model,
            server_generation=self._server_generation(server),
            source_type="clone_from_server",
            source_server_id=server.id,
            base_workload_profile=workload,
            raw_attributes=normalized["raw_attributes"],
            normalized_attributes=normalized["normalized_attributes"],
            custom_overrides={},
            final_attributes=final_attributes(normalized["normalized_attributes"], {}, workload),
            metadata_json={
                "source": "hpe-redfish",
                "source_server_serial": server.serial_number,
                "skipped_attributes": normalized["skipped_attributes"],
                "settings_uri": normalized["settings_uri"],
                "attribute_registry": normalized["attribute_registry"],
            },
            export_format="json",
        )
        self.db.add(profile)
        self.db.commit()
        self.db.refresh(profile)
        return profile

    def current_for_server(self, server_id: int) -> dict[str, Any]:
        server = self._server(server_id)
        bios_payload = self._read_current(server)
        normalized = normalize_bios_config(bios_payload)
        return {"server_id": server.id, "serial_number": server.serial_number, **normalized}

    def workload_options_for_server(self, server_id: int) -> dict[str, Any]:
        server = self._server(server_id)
        try:
            return {"server_id": server.id, "serial_number": server.serial_number, **self.hpe_client.read_workload_options(server)}
        except RedfishError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    def compare_profile(self, profile_id: int, target_server_id: int) -> dict[str, Any]:
        profile = self.get_profile(profile_id)
        current = self.current_for_server(target_server_id)
        diff = diff_attributes(
            profile.final_attributes or {},
            current.get("raw_attributes", {}),
            current.get("registry_attributes", {}),
        )
        return {
            "profile_id": profile.id,
            "target_server_id": target_server_id,
            "pending_reboot": bool(diff["changed"]),
            "diff": diff,
        }

    def apply_profile(self, profile_id: int, target_server_id: int, dry_run: bool = True) -> BIOSProfileApplyJob:
        profile = self.get_profile(profile_id)
        server = self._server(target_server_id)
        current = self.current_for_server(target_server_id)
        diff = diff_attributes(
            profile.final_attributes or {},
            current.get("raw_attributes", {}),
            current.get("registry_attributes", {}),
        )
        job = BIOSProfileApplyJob(
            profile_id=profile.id,
            target_server_id=server.id,
            status="dry_run" if dry_run else "planned",
            diff_before_apply=diff,
            previous_bios_backup=current.get("raw_attributes", {}),
            pending_reboot=bool(diff["changed"]),
            dry_run=dry_run,
            verification_result=None,
        )
        if not dry_run:
            if not self._real_apply_enabled():
                job.status = "failed"
                job.error_message = "Real BIOS deploy is disabled. Enable bios.enable_real_apply in global settings first."
            elif diff.get("unsupported"):
                job.status = "failed"
                job.error_message = "BIOS deploy blocked because the profile contains unsupported target attributes."
            elif not diff.get("apply_attributes"):
                job.status = "succeeded"
                job.applied_at = datetime.now(UTC)
            else:
                try:
                    result = self.hpe_client.apply_attributes(server, diff["apply_attributes"], dry_run=False)
                    job.status = "pending_reboot" if job.pending_reboot else "succeeded"
                    job.applied_at = datetime.now(UTC)
                    job.verification_result = {"apply_result": result}
                except RedfishError as exc:
                    job.status = "failed"
                    job.error_message = str(exc)
        self.db.add(job)
        self.db.commit()
        self.db.refresh(job)
        return job

    def verify_profile(self, profile_id: int, target_server_id: int) -> dict[str, Any]:
        comparison = self.compare_profile(profile_id, target_server_id)
        return {
            "profile_id": profile_id,
            "target_server_id": target_server_id,
            "verified_at": datetime.now(UTC).isoformat(),
            "verification_result": compliance_result(comparison["diff"]),
        }

    def _server(self, server_id: int) -> Server:
        server = self.db.get(Server, server_id)
        if server is None:
            raise HTTPException(status_code=404, detail="Server not found")
        return server

    def _read_current(self, server: Server) -> dict[str, Any]:
        try:
            return self.hpe_client.read_current(server)
        except RedfishError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    def _server_generation(self, server: Server) -> str | None:
        text = " ".join(str(value or "") for value in (server.model, server.product_name))
        for token in text.split():
            if token.lower().startswith("gen"):
                return token
        return None

    def _real_apply_enabled(self) -> bool:
        record = self.db.get(GlobalSetting, "global")
        settings = record.value_json if record is not None and isinstance(record.value_json, dict) else {}
        bios_settings = settings.get("bios") if isinstance(settings.get("bios"), dict) else {}
        return bool(bios_settings.get("enable_real_apply", False))
