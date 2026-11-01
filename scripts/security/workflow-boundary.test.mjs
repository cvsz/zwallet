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

test("DevOps CI/CD keeps PR validation read-only and production deployment operator-gated", () => {
  const workflow = readWorkflow("cicd.yml");
  const header = workflow.split(/^jobs:\s*$/m, 1)[0];

  assert.match(header, /^permissions:\s*\n\s+contents:\s*read\s*$/m);
  assert.doesNotMatch(header, /^\s+(?:id-token|packages):\s*write\b/m);
  assert.match(workflow, /^  workflow_dispatch:\s*\n    inputs:\s*\n      confirmation:/m);

  const jobBody = (name) => {
    const marker = `  ${name}:\n`;
    const start = workflow.indexOf(marker);
    assert.notEqual(start, -1, `missing ${name} job`);
    const rest = workflow.slice(start + marker.length);
    const nextJob = rest.search(/^  [A-Za-z0-9_-]+:\s*$/m);
    return nextJob === -1 ? rest : rest.slice(0, nextJob);
  };

  const ci = jobBody("ci");
  const build = jobBody("build-and-push");
  const deploy = jobBody("deploy-blue-green");

  assert.doesNotMatch(ci, /^\s+id-token:\s*write\b|^\s+packages:\s*write\b/m);
  assert.match(build, /permissions:\s*\n\s+contents:\s*read\n\s+packages:\s*write/m);
  assert.match(deploy, /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.match(deploy, /environment:\s*production/);
  assert.match(deploy, /permissions:\s*\n\s+contents:\s*read\n\s+id-token:\s*write/m);
  assert.match(deploy, /DEPLOY_CONFIRMATION/);
  assert.match(deploy, /Missing explicit deployment confirmation/);
  assert.match(deploy, /K8S_NAMESPACE must be configured/);
});
