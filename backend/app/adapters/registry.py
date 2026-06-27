from __future__ import annotations

from app.adapters.base import AdapterContext, BaseVendorAdapter
from app.adapters.dell.idrac_client import DellIdracAdapter
from app.adapters.generic.redfish import GenericRedfishAdapter
from app.adapters.hpe.ilo_client import HpeIloAdapter
from app.adapters.oem.redfish_client import OemRedfishAdapter
from app.utils.dmi import normalize_vendor


class AdapterRegistry:
    adapters: dict[str, type[BaseVendorAdapter]] = {
        "hpe": HpeIloAdapter,
        "dell": DellIdracAdapter,
        "generic_redfish": GenericRedfishAdapter,
        "oem": OemRedfishAdapter,
        "unknown": GenericRedfishAdapter,
    }

    @classmethod
    def select(cls, vendor: str | None, model: str | None = None, bmc_type: str | None = None) -> type[BaseVendorAdapter]:
        normalized = normalize_vendor(vendor)
        if normalized == "unknown" and bmc_type and "redfish" in bmc_type.lower():
            normalized = "generic_redfish"
        if normalized == "unknown" and model and "proliant" in model.lower():
            normalized = "hpe"
        return cls.adapters.get(normalized, GenericRedfishAdapter)

    @classmethod
    def build(cls, context: AdapterContext) -> BaseVendorAdapter:
        adapter_class = cls.select(context.vendor, context.model)
        return adapter_class(context)
