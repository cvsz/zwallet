import unittest
from pathlib import Path
import tempfile

from check_forbidden_patterns import inspect_text, is_runtime_source, scan


class ForbiddenPatternTests(unittest.TestCase):
    def test_environment_configuration_is_allowed(self):
        self.assertEqual(
            inspect_text('const port = Number(process.env.PORT ?? 8081);\nconst token = process.env.ADMIN_TOKEN;'),
            [],
        )

    def test_untrusted_client_certificate_header_is_rejected(self):
        self.assertEqual(
            inspect_text('const identity = req.headers["x-client-cert"];'),
            [(1, "untrusted-client-cert-header")],
        )

    def test_hardcoded_secret_is_rejected_without_echoing_value(self):
        self.assertEqual(
            inspect_text('const API_KEY = "0123456789abcdef0123456789abcdef";'),
            [(1, "hard-coded-credential")],
        )

    def test_explicit_placeholder_is_not_treated_as_a_secret(self):
        self.assertEqual(
            inspect_text('const API_KEY = "REPLACE_ME";'),
            [],
        )

    def test_tests_and_generated_files_are_excluded(self):
        self.assertFalse(is_runtime_source(Path("apps/admin-wallet/src/server.test.ts")))
        self.assertFalse(is_runtime_source(Path("apps/admin-wallet/dist/server.js")))
        self.assertTrue(is_runtime_source(Path("apps/admin-wallet/src/server.ts")))

    def test_repository_source_scan_has_no_policy_findings(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "apps/admin-wallet/src").mkdir(parents=True)
            (root / "apps/admin-wallet/src/server.ts").write_text(
                "const port = Number(process.env.PORT ?? 8081);\n",
                encoding="utf-8",
            )
            self.assertEqual(scan(root), [])


if __name__ == "__main__":
    unittest.main()
