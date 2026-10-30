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

test("Codex PR audit is immutable, read-only, and has no write token scope", () => {
  const workflow = readWorkflow("codex-pr-gate.yml");
  assert.match(workflow, /uses:\s*openai\/codex-action@[0-9a-f]{40}/);
  assert.match(workflow, /permission-profile:\s*":read-only"/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/);
  assert.match(workflow, /if:\s*github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);

  const enforcement = workflow.split("      - name: Enforce Codex result without shell interpolation", 2)[1];
  assert.ok(enforcement, "Codex result enforcement step must exist");
  assert.match(enforcement, /CODEX_FINAL_MESSAGE:\s*\$\{\{\s*steps\.codex\.outputs\.final-message\s*\}\}/);
  assert.match(enforcement, /python3 - <<'PY/);
  assert.doesNotMatch(
    enforcement,
    /run:\s*\|[\s\S]*\$\{\{\s*steps\.codex\.outputs\.final-message\s*\}\}/,
    "untrusted Codex output must never be interpolated into shell source",
  );
});

test("all Codex action references are pinned to full commit SHAs", () => {
  const files = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/i.test(name));
  const references = [];
  for (const name of files) {
    const source = readWorkflow(name);
    for (const match of source.matchAll(/uses:\s*openai\/codex-action@([^\s#]+)/g)) {
      references.push({ file: name, ref: match[1] });
    }
  }
  assert.equal(references.length, 1, "expected exactly one Codex action workflow");
  for (const reference of references) {
    assert.match(reference.ref, /^[0-9a-f]{40}$/, `${reference.file} must pin Codex action by full SHA`);
  }
});
