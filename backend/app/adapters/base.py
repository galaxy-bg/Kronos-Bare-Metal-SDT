from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BmcCredential:
    username: str
    password: str


@dataclass(frozen=True)
class AdapterContext:
    vendor: str
    model: str | None
    bmc_ip: str | None
    credential: BmcCredential | None = None


class BaseVendorAdapter(ABC):
    vendor = "unknown"

    def __init__(self, context: AdapterContext) -> None:
        self.context = context

    @abstractmethod
    def detect(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_system_inventory(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_bios_config(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def set_bios_config(self, config: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_storage_inventory(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_raid_config(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def set_raid_config(self, config: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def get_firmware_inventory(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def set_uid_led(self, state: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def power_status(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def power_on(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def power_off(self) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def reboot(self) -> dict[str, Any]:
        raise NotImplementedError


class StubVendorAdapter(BaseVendorAdapter):
    vendor = "unknown"

    def _stub(self, capability: str) -> dict[str, Any]:
        return {
            "vendor": self.vendor,
            "capability": capability,
            "implemented": False,
            "message": "Adapter method is not implemented in Phase-1.",
        }

    def detect(self) -> dict[str, Any]:
        return self._stub("detect")

    def get_system_inventory(self) -> dict[str, Any]:
        return self._stub("get_system_inventory")

    def get_bios_config(self) -> dict[str, Any]:
        return self._stub("get_bios_config")

    def set_bios_config(self, config: dict[str, Any]) -> dict[str, Any]:
        # TODO: BIOS profile apply.
        return self._stub("set_bios_config")

    def get_storage_inventory(self) -> dict[str, Any]:
        return self._stub("get_storage_inventory")

    def get_raid_config(self) -> dict[str, Any]:
        return self._stub("get_raid_config")

    def set_raid_config(self, config: dict[str, Any]) -> dict[str, Any]:
        # TODO: RAID profile apply.
        return self._stub("set_raid_config")

    def get_firmware_inventory(self) -> dict[str, Any]:
        # TODO: firmware update.
        return self._stub("get_firmware_inventory")

    def set_uid_led(self, state: str) -> dict[str, Any]:
        return self._stub("set_uid_led")

    def power_status(self) -> dict[str, Any]:
        return self._stub("power_status")

    def power_on(self) -> dict[str, Any]:
        return self._stub("power_on")

    def power_off(self) -> dict[str, Any]:
        return self._stub("power_off")

    def reboot(self) -> dict[str, Any]:
        return self._stub("reboot")
