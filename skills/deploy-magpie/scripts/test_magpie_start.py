"""Check readiness against the actual Magpie gateway identity contract."""
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location("magpie_start", Path(__file__).with_name("magpie-start.py"))
starter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(starter)


class ReadinessTest(unittest.TestCase):
    def probe(self, body, status=200):
        response = io.BytesIO(body)
        response.status = status
        with patch.object(starter.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = response
            result = starter.healthy()
            build.return_value.open.assert_called_once_with("http://127.0.0.1:3425/", timeout=2)
            self.assertEqual(build.call_args.args[0].proxies, {})
            return result

    def test_gateway_identity_is_ready_without_accounts(self):
        self.assertTrue(self.probe(b'{"name":"magpie","models":0}'))

    def test_unrelated_or_malformed_service_is_not_ready(self):
        for body in (b'{"name":"other"}', b'[]', b'not json'):
            with self.subTest(body=body):
                self.assertFalse(self.probe(body))
        self.assertFalse(self.probe(b'{"name":"magpie"}', status=503))

    def test_unreachable_or_missing_endpoint_is_not_ready(self):
        errors = (OSError("connection refused"), urllib.error.HTTPError("http://127.0.0.1:3425/", 404, "missing", {}, None))
        for error in errors:
            with self.subTest(error=error), patch.object(starter.urllib.request, "build_opener") as build:
                build.return_value.open.side_effect = error
                self.assertFalse(starter.healthy())


if __name__ == "__main__":
    unittest.main()
