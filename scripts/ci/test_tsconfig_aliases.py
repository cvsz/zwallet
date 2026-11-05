import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class TypeScriptWorkspaceResolutionTests(unittest.TestCase):
    def test_rpc_build_precedes_recursive_typecheck(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        script = package["scripts"]["typecheck"]
        self.assertEqual(
            script,
            "pnpm --filter @zwallet/rpc build && pnpm -r --if-present run typecheck",
        )

    def test_runtime_package_exports_remain_dist_based(self):
        package = json.loads((ROOT / "packages/rpc/package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["exports"]["."]["types"], "./dist/index.d.ts")
        self.assertEqual(package["exports"]["."]["default"], "./dist/index.js")

    def test_typecheck_does_not_pull_cross_project_sources_into_rootdir(self):
        tsconfig = json.loads((ROOT / "tsconfig.base.json").read_text(encoding="utf-8"))
        self.assertNotIn("@zwallet/rpc", tsconfig["compilerOptions"].get("paths", {}))


if __name__ == "__main__":
    unittest.main()
