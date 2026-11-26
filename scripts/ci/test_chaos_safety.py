import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/chaos.yml").read_text(encoding="utf-8")
SCRIPT = (ROOT / "tests/chaos/kill-pod.sh").read_text(encoding="utf-8")


class ChaosSafetyContractTests(unittest.TestCase):
    def test_pull_request_workflow_is_validation_only(self):
        self.assertIn("pull_request:", WORKFLOW)
        self.assertIn("bash -n tests/chaos/kill-pod.sh", WORKFLOW)
        self.assertIn("node --test scripts/security/workflow-boundary.test.mjs", WORKFLOW)
        self.assertNotIn("kubectl", WORKFLOW)
        self.assertNotIn("environment:", WORKFLOW)
        self.assertNotIn("secrets.", WORKFLOW)

    def test_destructive_script_requires_explicit_confirmation_and_isolation(self):
        self.assertIn('CONFIRM_CHAOS:-', SCRIPT)
        self.assertIn('NAMESPACE="${CHAOS_NAMESPACE:-}"', SCRIPT)
        self.assertIn('if [[ "$NAMESPACE" != "chaos-lab" ]]', SCRIPT)
        self.assertIn('SELECTOR="app=zwallet-chaos-target"', SCRIPT)
        self.assertIn('kubectl delete pod "$POD" -n "$NAMESPACE" --wait=false', SCRIPT)
        self.assertNotIn('CHAOS_NAMESPACE:-default', SCRIPT)


if __name__ == "__main__":
    unittest.main()
