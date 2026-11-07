"""Regression contracts for the hash-locked Python security update workflow."""

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/supply-chain.yml").read_text(encoding="utf-8")
REQUIREMENTS = (ROOT / "api/requirements.in").read_text(encoding="utf-8")


class SupplyChainLockCompilerTests(unittest.TestCase):
    def test_security_floor_overrides_are_derived_from_authoritative_input(self):
        self.assertIn("grep -Ei", WORKFLOW)
        self.assertIn("api/requirements.in > /tmp/zwallet-security-overrides.in", WORKFLOW)
        self.assertIn("--constraint api/requirements.txt", WORKFLOW)
        self.assertIn("--overrides /tmp/zwallet-security-overrides.in", WORKFLOW)
        self.assertIn('grep -Eiq "^${package}"', WORKFLOW)
        for package in ("PyJWT", "anyio", "certifi", "cryptography", "pyasn1", "starlette"):
            self.assertRegex(REQUIREMENTS, rf"(?im)^{re.escape(package)}(?:\[[^]]+\])?\s*(?:>=|==|~=)")

    def test_hashes_remain_required_and_committed_lock_is_compared(self):
        self.assertIn("--generate-hashes", WORKFLOW)
        self.assertIn("diff -u api/requirements.txt /tmp/zwallet-api-requirements.txt", WORKFLOW)

    def test_trivy_blocks_high_and_critical_including_unfixed(self):
        self.assertIn('severity: "CRITICAL,HIGH"', WORKFLOW)
        self.assertIn('exit-code: "1"', WORKFLOW)
        self.assertIn("ignore-unfixed: false", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
