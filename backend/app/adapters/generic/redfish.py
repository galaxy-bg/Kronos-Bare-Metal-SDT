from __future__ import annotations

from app.adapters.base import StubVendorAdapter


class GenericRedfishAdapter(StubVendorAdapter):
    vendor = "generic_redfish"
