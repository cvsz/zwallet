import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class TypeScriptWorkspaceResolutionTests(unittest.TestCase):
    def test_rpc_source_is_used_for_typecheck_without_changing_runtime_exports(self):
        tsconfig = json.loads((ROOT / "tsconfig.base.json").read_text(encoding="utf-8"))
        package = json.loads((ROOT / "packages/rpc/package.json").read_text(encoding="utf-8"))
        self.assertEqual(tsconfig["compilerOptions"]["baseUrl"], ".")
        self.assertEqual(
            tsconfig["compilerOptions"]["paths"]["@zwallet/rpc"],
            ["packages/rpc/src/index.ts"],
        )
        self.assertEqual(package["exports"]["."]["types"], "./dist/index.d.ts")
        self.assertEqual(package["exports"]["."]["default"], "./dist/index.js")


if __name__ == "__main__":
    unittest.main()
