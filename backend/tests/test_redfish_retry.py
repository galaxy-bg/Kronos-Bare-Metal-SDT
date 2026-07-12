from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch
from urllib.error import URLError

from app.utils.redfish import RedfishError, redfish_get_json


class RedfishGetRetryTests(unittest.TestCase):
    @patch("app.utils.redfish.time.sleep")
    @patch("app.utils.redfish.urlopen")
    def test_retries_transient_tls_error(self, urlopen: MagicMock, sleep: MagicMock) -> None:
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"Members": []}'
        urlopen.side_effect = [URLError("TLS handshake timed out"), response]

        result = redfish_get_json("https://ilo", "/redfish/v1/", "user", "pass")

        self.assertEqual(result, {"Members": []})
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(0.5)

    @patch("app.utils.redfish.time.sleep")
    @patch("app.utils.redfish.urlopen", side_effect=URLError("TLS handshake timed out"))
    def test_reports_error_after_retry_budget(self, urlopen: MagicMock, sleep: MagicMock) -> None:
        with self.assertRaisesRegex(RedfishError, "TLS handshake timed out"):
            redfish_get_json("https://ilo", "/redfish/v1/", "user", "pass", attempts=3)
        self.assertEqual(urlopen.call_count, 3)
        self.assertEqual(sleep.call_count, 2)


if __name__ == "__main__":
    unittest.main()
