import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/chaos.yml").read_text(encoding="utf-8")
SCRIPT = (ROOT / "tests/chaos/kill-pod.sh").read_text(encoding="utf-8")
DEPLOY_WORKFLOW = (ROOT / ".github/workflows/cicd.yml").read_text(encoding="utf-8")


class ChaosSafetyContractTests(unittest.TestCase):
    def test_pull_request_path_is_static_only(self):
        static_job = WORKFLOW.split("  static:", 1)[1].split("  chaos:", 1)[0]
        self.assertIn("if: github.event_name == 'pull_request'", static_job)
        self.assertIn("bash -n tests/chaos/kill-pod.sh", static_job)
        self.assertNotIn("kubectl delete", static_job)

    def test_destructive_chaos_job_requires_manual_dispatch_and_environment(self):
        chaos_job = WORKFLOW.split("  chaos:", 1)[1]
        self.assertIn("if: github.event_name == 'workflow_dispatch'", chaos_job)
        self.assertIn("environment: chaos-lab", chaos_job)
        self.assertIn('CONFIRMATION" == "RUN-CHAOS"', chaos_job)
        self.assertIn('TARGET_NAMESPACE" == "chaos-lab"', chaos_job)
        self.assertIn("CHAOS_KUBECONFIG_DATA", chaos_job)
        self.assertIn("CHAOS_KUBE_CONTEXT", chaos_job)

    def test_chaos_script_requires_confirmation_namespace_and_explicit_label(self):
        self.assertIn('CONFIRM_CHAOS:-', SCRIPT)
        self.assertIn('NAMESPACE:-', SCRIPT)
        self.assertIn('NAMESPACE" != "chaos-lab"', SCRIPT)
        self.assertIn('app=zwallet-chaos-target', SCRIPT)
        self.assertNotIn("-n zwallet ", SCRIPT)
        self.assertNotIn("kubectl get pods -n zwallet", SCRIPT)

    def test_production_deployment_is_manual_and_confirmation_gated(self):
        self.assertIn("workflow_dispatch:", DEPLOY_WORKFLOW)
        self.assertIn("Type DEPLOY to authorize a production deployment", DEPLOY_WORKFLOW)
        deploy_job = DEPLOY_WORKFLOW.split("  deploy-blue-green:", 1)[1]
        self.assertIn("if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'", deploy_job)
        self.assertIn("environment: production", deploy_job)
        self.assertIn('DEPLOY_CONFIRMATION" == "DEPLOY"', deploy_job)
        self.assertIn("K8S_NAMESPACE must be configured", deploy_job)
        self.assertNotIn("kubectl apply -f infra/chaos/chaos-pipeline.yaml", deploy_job)
        self.assertNotIn("if: github.ref == 'refs/heads/main'", deploy_job)


if __name__ == "__main__":
    unittest.main()
