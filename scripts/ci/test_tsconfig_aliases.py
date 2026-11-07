import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class TypeScriptWorkspaceResolutionTests(unittest.TestCase):
    def test_exported_declarations_build_before_recursive_typecheck(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(
            package["scripts"]["typecheck"],
            "pnpm --filter @zwallet/shared-types build && pnpm --filter @zwallet/rpc build && pnpm --filter @zwallet/wallet-engine build && pnpm -r --if-present run typecheck",
        )

        shared = json.loads((ROOT / "packages/shared-types/package.json").read_text(encoding="utf-8"))
        self.assertEqual(shared["scripts"]["build"], "tsc -p tsconfig.json")
        self.assertEqual(shared["exports"]["./wallet"]["types"], "./dist/wallet.d.ts")
        self.assertEqual(shared["exports"]["./contracts"]["types"], "./dist/contracts.d.ts")

        rpc = json.loads((ROOT / "packages/rpc/package.json").read_text(encoding="utf-8"))
        self.assertEqual(rpc["scripts"]["build"], "tsc -p tsconfig.json")
        self.assertEqual(rpc["exports"]["."]["types"], "./dist/index.d.ts")

        wallet_engine = json.loads((ROOT / "services/wallet-engine/package.json").read_text(encoding="utf-8"))
        self.assertEqual(wallet_engine["dependencies"]["@zwallet/shared-types"], "workspace:*")
        self.assertEqual(wallet_engine["exports"]["./walletEngine"]["types"], "./dist/walletEngine.d.ts")

        admin_wallet = json.loads((ROOT / "apps/admin-wallet/package.json").read_text(encoding="utf-8"))
        self.assertEqual(admin_wallet["dependencies"]["@zwallet/wallet-engine"], "workspace:*")

    def test_runtime_package_exports_remain_dist_based(self):
        package = json.loads((ROOT / "packages/rpc/package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["exports"]["."]["types"], "./dist/index.d.ts")
        self.assertEqual(package["exports"]["."]["default"], "./dist/index.js")

    def test_typecheck_does_not_pull_cross_project_sources_into_rootdir(self):
        tsconfig = json.loads((ROOT / "tsconfig.base.json").read_text(encoding="utf-8"))
        self.assertNotIn("@zwallet/rpc", tsconfig["compilerOptions"].get("paths", {}))


if __name__ == "__main__":
    unittest.main()
