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
from app.models.server_action import ServerAction
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
        source_type = payload.source_type if payload.source_type in {"custom", "template", "derived_from_profile"} else "custom"
        profile = BIOSProfile(
            name=payload.name,
            vendor=payload.vendor,
            server_model=payload.server_model,
            server_generation=payload.server_generation,
            source_type=source_type,
            source_server_id=payload.source_server_id,
            base_workload_profile=payload.base_workload_profile,
            raw_attributes=dict(payload.raw_attributes or {}),
            normalized_attributes=normalized,
            custom_overrides=overrides,
            final_attributes=final_attributes(normalized, overrides, payload.base_workload_profile),
            metadata_json={"source": source_type},
            export_format="json",
        )
        self.db.add(profile)
        if payload.source_server_id:
            self._add_action(
                payload.source_server_id,
                "bios_profile_custom_create",
                "succeeded",
                {"profile_name": payload.name, "base_workload_profile": payload.base_workload_profile},
                {"message": "Custom BIOS profile created."},
            )
        self.db.commit()
        self.db.refresh(profile)
        if payload.source_server_id:
            self._record_profile_action_result(payload.source_server_id, "bios_profile_custom_create", profile.id)
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
        if profile.source_server_id:
            self._add_action(
                profile.source_server_id,
                "bios_profile_update",
                "succeeded",
                {"profile_id": profile.id, "profile_name": profile.name},
                {"profile_id": profile.id, "message": "BIOS profile updated."},
            )
        self.db.commit()
        self.db.refresh(profile)
        return profile

    def delete_profile(self, profile_id: int) -> None:
        profile = self.get_profile(profile_id)
        source_server_id = profile.source_server_id
        profile_name = profile.name
        self.db.delete(profile)
        if source_server_id:
            self._add_action(
                source_server_id,
                "bios_profile_delete",
                "succeeded",
                {"profile_id": profile_id, "profile_name": profile_name},
                {"profile_id": profile_id, "message": "BIOS profile deleted."},
            )
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
        self._add_action(
            server.id,
            "bios_profile_clone",
            "succeeded",
            {"profile_name": name, "base_workload_profile": workload},
            {"message": "BIOS profile cloned from server."},
        )
        self.db.commit()
        self.db.refresh(profile)
        self._record_profile_action_result(server.id, "bios_profile_clone", profile.id)
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
        self._record_action(
            target_server_id,
            "bios_profile_compare",
            "succeeded",
            {"profile_id": profile.id, "profile_name": profile.name},
            {"changed_count": diff["changed_count"], "unsupported_count": diff["unsupported_count"], "pending_reboot": bool(diff["changed"])},
        )
        return {
            "profile_id": profile.id,
            "target_server_id": target_server_id,
            "pending_reboot": bool(diff["changed"]),
            "diff": diff,
        }

    def apply_profile(self, profile_id: int, target_server_id: int, dry_run: bool = True, post_reboot: bool = False) -> BIOSProfileApplyJob:
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
        action_status = "succeeded" if dry_run else "running"
        action_result: dict[str, Any] = {
            "profile_id": profile.id,
            "profile_name": profile.name,
            "dry_run": dry_run,
            "changed_count": diff["changed_count"],
            "unsupported_count": diff["unsupported_count"],
            "pending_reboot": bool(diff["changed"]),
            "message": "BIOS dry-run completed. No BIOS changes were applied." if dry_run else "BIOS deploy started.",
        }
        action_error: str | None = None
        if not dry_run:
            if not self._real_apply_enabled():
                job.status = "failed"
                job.error_message = "Real BIOS deploy is disabled. Enable bios.enable_real_apply in global settings first."
                action_status = "failed"
                action_error = job.error_message
            elif diff.get("unsupported"):
                job.status = "failed"
                job.error_message = "BIOS deploy blocked because the profile contains unsupported target attributes."
                action_status = "failed"
                action_error = job.error_message
            elif not diff.get("apply_attributes"):
                job.status = "succeeded"
                job.applied_at = datetime.now(UTC)
                action_status = "succeeded"
                action_result["message"] = "No BIOS changes were required."
            else:
                try:
                    result = self.hpe_client.apply_attributes(server, diff["apply_attributes"], dry_run=False)
                    job.status = "pending_reboot" if job.pending_reboot else "succeeded"
                    job.applied_at = datetime.now(UTC)
                    job.verification_result = {"apply_result": result}
                    action_status = "succeeded"
                    action_result["apply_result"] = result
                    action_result["message"] = (
                        "BIOS deploy submitted. Reboot is required; reboot was not triggered."
                        if job.pending_reboot
                        else "BIOS deploy submitted."
                    )
                except RedfishError as exc:
                    job.status = "failed"
                    job.error_message = str(exc)
                    action_status = "failed"
                    action_error = str(exc)
        self.db.add(job)
        self._add_action(
            server.id,
            "bios_profile_dry_run" if dry_run else "bios_profile_deploy",
            action_status,
            {
                "profile_id": profile.id,
                "profile_name": profile.name,
                "post_reboot": post_reboot,
                "changed_attributes": list(diff.get("apply_attributes", {}).keys()),
            },
            action_result,
            action_error,
        )
        self.db.commit()
        self.db.refresh(job)
        if post_reboot and not dry_run and job.status in {"pending_reboot", "succeeded"} and job.pending_reboot:
            self._add_action(
                server.id,
                "bios_reboot_after_apply",
                "planned",
                {"profile_id": profile.id, "profile_name": profile.name, "reason": "BIOS profile deploy requested post-task reboot."},
                {"message": "Reboot is planned after BIOS profile deploy. Execute manually from Tasks."},
            )
            self.db.commit()
        return job

    def verify_profile(self, profile_id: int, target_server_id: int) -> dict[str, Any]:
        comparison = self.compare_profile(profile_id, target_server_id)
        verification = compliance_result(comparison["diff"])
        self._record_action(
            target_server_id,
            "bios_profile_verify",
            "succeeded" if verification["compliant"] else "failed",
            {"profile_id": profile_id},
            {"verification_result": verification},
            None if verification["compliant"] else "BIOS profile is not compliant.",
        )
        return {
            "profile_id": profile_id,
            "target_server_id": target_server_id,
            "verified_at": datetime.now(UTC).isoformat(),
            "verification_result": verification,
        }

    def validate_attributes(self, target_server_id: int, attributes: dict[str, Any], base_workload_profile: str | None = None) -> dict[str, Any]:
        current = self.current_for_server(target_server_id)
        registry_attributes = current.get("registry_attributes", {})
        desired = final_attributes({}, attributes, base_workload_profile)
        unsupported: dict[str, Any] = {}
        invalid_values: dict[str, dict[str, Any]] = {}

        for name, value in desired.items():
            registry = registry_attributes.get(name) if isinstance(registry_attributes, dict) else None
            if not isinstance(registry, dict):
                unsupported[name] = value
                continue
            allowed_values = registry.get("Value") or registry.get("AllowableValues") or []
            normalized_allowed = []
            if isinstance(allowed_values, list):
                for item in allowed_values:
                    if isinstance(item, dict) and item.get("ValueName"):
                        normalized_allowed.append(str(item["ValueName"]))
                    elif item is not None:
                        normalized_allowed.append(str(item))
            if normalized_allowed and str(value) not in normalized_allowed:
                invalid_values[name] = {"value": value, "allowed_values": normalized_allowed}

        result = {
            "valid": not unsupported and not invalid_values,
            "target_server_id": target_server_id,
            "checked_count": len(desired),
            "unsupported": unsupported,
            "invalid_values": invalid_values,
        }
        self._record_action(
            target_server_id,
            "bios_profile_validate",
            "succeeded" if result["valid"] else "failed",
            {"base_workload_profile": base_workload_profile, "attributes": attributes},
            result,
            None if result["valid"] else "BIOS profile validation found issues.",
        )
        return result

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

    def _add_action(
        self,
        server_id: int,
        action_type: str,
        status: str,
        payload_json: dict[str, Any],
        result_json: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> None:
        now = datetime.now(UTC)
        self.db.add(
            ServerAction(
                server_id=server_id,
                action_type=action_type,
                status=status,
                payload_json=payload_json,
                result_json=result_json,
                error_message=error_message,
                started_at=now if status in {"running", "succeeded", "failed"} else None,
                completed_at=now if status in {"succeeded", "failed"} else None,
            )
        )

    def _record_action(
        self,
        server_id: int,
        action_type: str,
        status: str,
        payload_json: dict[str, Any],
        result_json: dict[str, Any] | None = None,
        error_message: str | None = None,
    ) -> None:
        self._add_action(server_id, action_type, status, payload_json, result_json, error_message)
        self.db.commit()

    def _record_profile_action_result(self, server_id: int, action_type: str, profile_id: int) -> None:
        action = (
            self.db.query(ServerAction)
            .filter(ServerAction.server_id == server_id, ServerAction.action_type == action_type)
            .order_by(ServerAction.requested_at.desc())
            .first()
        )
        if not action:
            return
        result = dict(action.result_json or {})
        result["profile_id"] = profile_id
        action.result_json = result
        self.db.commit()
