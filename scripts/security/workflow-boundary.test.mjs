import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const WORKFLOWS = join(ROOT, ".github", "workflows");

function readWorkflow(name) {
  return readFileSync(join(WORKFLOWS, name), "utf8");
}

function activeYamlLines(source) {
  return source
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

test("no workflow uses the privileged workflow_run event", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/i.test(name));
  for (const name of files) {
    assert.doesNotMatch(
      activeYamlLines(readWorkflow(name)),
      /^\s*workflow_run\s*:/m,
      `${name} must not run privileged follow-up automation from workflow_run`,
    );
  }
  assert.equal(existsSync(join(WORKFLOWS, "codex-autofix.yml")), false);
});

test("supply-chain validation is local-only and read-only", () => {
  const workflow = readWorkflow("supply-chain.yml");
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/m);
  assert.doesNotMatch(workflow, /^\s*(?:packages|id-token):\s*write\b/m);
  assert.doesNotMatch(workflow, /\bdocker\s+login\b|\bdocker\s+push\b|\bcosign\s+sign\b/i);
  assert.match(workflow, /docker build --pull --tag/);
  assert.match(workflow, /image-ref:\s*\$\{\{\s*env\.IMAGE_REF\s*\}\}/);
  assert.match(workflow, /output-file:\s*sbom\.json/);
});

test("PR workflow gate does not expose secrets or invoke a hosted Codex action", () => {
  const workflow = readWorkflow("codex-pr-gate.yml");
  assert.match(workflow, /^\s*pull_request:/m);
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/m);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /node --test scripts\/security\/workflow-boundary\.test\.mjs/);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /openai\/codex-action/i);
});

test("workflow boundary gate pins checkout to a full commit SHA", () => {
  const workflow = readWorkflow("codex-pr-gate.yml");
  const references = [...workflow.matchAll(/uses:\s*actions\/checkout@([^\s#]+)/g)];
  assert.equal(references.length, 1, "expected exactly one checkout action");
  assert.match(references[0][1], /^[0-9a-f]{40}$/);
});

test("trust-boundary documentation matches the read-only workflow implementation", () => {
  const documentation = readFileSync(
    join(ROOT, "docs", "security", "GITHUB-ACTIONS-TRUST-BOUNDARY.md"),
    "utf8",
  );
  const workflow = readWorkflow("codex-pr-gate.yml");

  assert.match(workflow, /^name:\s*Workflow Boundary Contract$/m);
  assert.match(documentation, /read-only workflow contract test/i);
  assert.match(documentation, /does not invoke Codex/i);
  assert.match(documentation, /does not reference repository secrets/i);
  assert.doesNotMatch(documentation, /The remaining Codex PR gate/);
  assert.doesNotMatch(documentation, /uses the `:read-only` Codex permission profile/);
  assert.doesNotMatch(documentation, /transports the model result through an environment variable/);
});

test("production publication and deployment remain disabled until a separately reviewed release workflow exists", () => {
  const names = readdirSync(WORKFLOWS).filter((name) => /\\.ya?ml$/i.test(name));
  assert.equal(existsSync(join(WORKFLOWS, "cicd.yml")), false);

  for (const name of names) {
    const workflow = activeYamlLines(readWorkflow(name));
    assert.doesNotMatch(
      workflow,
      /^\\s*(?:packages|id-token):\\s*write\\b/m,
      `${name} must not grant registry or OIDC write permissions in this containment candidate`,
    );
    assert.doesNotMatch(
      workflow,
      /\\bdocker\\s+push\\b|\\bkubectl\\s+(?:apply|delete|patch|drain|scale)\\b|docker\\/build-push-action/i,
      `${name} must not publish images or mutate a cluster`,
    );
  }

  assert.match(readWorkflow("ci.yml"), /pnpm install/);
  assert.match(readWorkflow("supply-chain.yml"), /docker build --pull --tag/);
});

test("workspace typecheck builds exported RPC declarations before consumers", () => {
  const rootPackage = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const rpcPackage = JSON.parse(readFileSync(join(ROOT, "packages", "rpc", "package.json"), "utf8"));

  assert.equal(
    rootPackage.scripts.typecheck,
    "pnpm --filter @zwallet/rpc build && pnpm -r --if-present run typecheck",
  );
  assert.equal(rpcPackage.exports["."].types, "./dist/index.d.ts");
  assert.equal(rpcPackage.exports["."].default, "./dist/index.js");
});

test("RPC package explicitly emits declarations at its published types path", () => {
  const rpcPackage = JSON.parse(readFileSync(join(ROOT, "packages", "rpc", "package.json"), "utf8"));
  const rpcConfig = JSON.parse(readFileSync(join(ROOT, "packages", "rpc", "tsconfig.json"), "utf8"));

  assert.equal(rpcPackage.types, "./dist/index.d.ts");
  assert.equal(rpcPackage.exports["."].types, "./dist/index.d.ts");
  assert.equal(rpcConfig.compilerOptions.declaration, true);
  assert.equal(rpcConfig.compilerOptions.declarationDir, "dist");
});

test("pull-request chaos workflow is validation-only and never mutates a cluster", () => {
  const workflow = activeYamlLines(readWorkflow("chaos.yml"));

  assert.match(workflow, /^name: Chaos Safety Contract$/m);
  assert.match(workflow, /^  pull_request:/m);
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/m);
  assert.match(workflow, /bash -n tests\/chaos\/kill-pod\.sh/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.doesNotMatch(workflow, /bash\s+tests\/chaos\/kill-pod\.sh/);
  assert.doesNotMatch(workflow, /kubectl\s+(?:delete|apply|patch|drain|scale)\b/i);
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  const checkouts = [...workflow.matchAll(/uses:\s*actions\/checkout@([^\s#]+)/g)];
  assert.equal(checkouts.length, 1);
  assert.match(checkouts[0][1], /^[0-9a-f]{40}$/);
});
