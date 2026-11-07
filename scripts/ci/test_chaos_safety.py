import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/chaos.yml").read_text(encoding="utf-8")
SCRIPT = (ROOT / "tests/chaos/kill-pod.sh").read_text(encoding="utf-8")


class ChaosSafetyContractTests(unittest.TestCase):
    def test_pull_request_workflow_is_static_only(self):
        self.assertIn("  pull_request:", WORKFLOW)
        self.assertIn("bash -n tests/chaos/kill-pod.sh", WORKFLOW)
        self.assertIn("node --test scripts/security/workflow-boundary.test.mjs", WORKFLOW)
        self.assertNotIn("workflow_dispatch:", WORKFLOW)
        self.assertNotIn("kubectl delete", WORKFLOW)
        self.assertNotIn("kubectl apply", WORKFLOW)
        self.assertNotIn("${{ secrets.", WORKFLOW)

    def test_destructive_chaos_script_is_not_wired_to_automation(self):
        self.assertNotIn("\n  chaos:", WORKFLOW)
        self.assertNotIn("workflow_dispatch:", WORKFLOW)
        self.assertNotIn("CHAOS_KUBECONFIG_DATA", WORKFLOW)
        self.assertNotIn("CHAOS_KUBE_CONTEXT", WORKFLOW)

    def test_chaos_script_requires_confirmation_namespace_and_explicit_label(self):
        self.assertIn('CONFIRM_CHAOS:-', SCRIPT)
        self.assertIn('NAMESPACE:-', SCRIPT)
        self.assertIn('NAMESPACE" != "chaos-lab"', SCRIPT)
        self.assertIn('app=zwallet-chaos-target', SCRIPT)
        self.assertNotIn("-n zwallet ", SCRIPT)
        self.assertNotIn("kubectl get pods -n zwallet", SCRIPT)

    def test_production_deployment_workflows_remain_absent_until_operator_admission(self):
        workflows = ROOT / ".github/workflows"
        for name in ("cicd.yml", "deploy.yml", "deploy-k8s.yml"):
            self.assertFalse(
                (workflows / name).exists(),
                f"{name} must not be restored before a separately approved deployment admission",
            )


if __name__ == "__main__":
    unittest.main()
