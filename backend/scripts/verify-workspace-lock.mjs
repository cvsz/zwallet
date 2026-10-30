#!/usr/bin/env node
/**
 * Enforce the backend package-manager boundary and committed npm workspace lock.
 *
 * The repository root is a pnpm workspace. The backend/ tree is an independent
 * npm workspace and must not be re-added to the root pnpm workspace: doing so
 * creates competing lockfile authorities for the same gateway packages.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const backendRoot = process.cwd();
const repositoryRoot = path.resolve(backendRoot, '..');

function readJson(file) {
  assert.ok(existsSync(file), `required workspace file is missing: ${path.relative(repositoryRoot, file)}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function stableJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => item));
  if (value && typeof value === 'object') {
    return JSON.stringify(Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
    ));
  }
  return JSON.stringify(value ?? {});
}

const rootWorkspaceFile = path.join(repositoryRoot, 'pnpm-workspace.yaml');
const rootWorkspaceText = readFileSync(rootWorkspaceFile, 'utf8');
const rootWorkspaceEntries = [...rootWorkspaceText.matchAll(/^\s*-\s*['"]([^'"]+)['"]\s*$/gm)]
  .map((match) => match[1]);

const overlappingRootEntries = rootWorkspaceEntries.filter((entry) =>
  entry === 'backend' || entry.startsWith('backend/'),
);
assert.deepEqual(
  overlappingRootEntries,
  [],
  'backend packages must remain owned by backend/package-lock.json, not the root pnpm workspace',
);

const backendManifest = readJson(path.join(backendRoot, 'package.json'));
const lock = readJson(path.join(backendRoot, 'package-lock.json'));
assert.equal(lock.lockfileVersion, 3, 'backend npm workspace requires a committed lockfile v3');
assert.ok(Array.isArray(backendManifest.workspaces), 'backend/package.json must declare npm workspaces');

const lockRoot = lock.packages?.[''];
assert.ok(lockRoot, 'backend/package-lock.json must contain its root package entry');
assert.deepEqual(
  [...(lockRoot.workspaces ?? [])].sort(),
  [...backendManifest.workspaces].sort(),
  'backend npm workspace globs differ between package.json and package-lock.json',
);

let checkedPackages = 0;
for (const pattern of backendManifest.workspaces) {
  assert.match(pattern, /^(packages|services)\/\*$/, `unsupported backend workspace pattern: ${pattern}`);
  const parent = path.join(backendRoot, pattern.slice(0, -2));
  assert.ok(existsSync(parent), `backend workspace directory is missing: ${pattern}`);

  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(parent, entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;

    const relativePath = path.posix.join(pattern.slice(0, -2), entry.name);
    const manifest = readJson(manifestPath);
    const locked = lock.packages?.[relativePath];
    assert.ok(locked, `workspace package is absent from package-lock.json: ${relativePath}`);
    assert.equal(locked.name, manifest.name, `workspace name mismatch: ${relativePath}`);
    assert.equal(locked.version ?? '0.0.0', manifest.version ?? '0.0.0', `workspace version mismatch: ${relativePath}`);
    assert.equal(
      stableJson(locked.dependencies),
      stableJson(manifest.dependencies),
      `runtime dependency specs differ from the lockfile: ${relativePath}`,
    );
    assert.equal(
      stableJson(locked.devDependencies),
      stableJson(manifest.devDependencies),
      `development dependency specs differ from the lockfile: ${relativePath}`,
    );
    assert.equal(
      stableJson(locked.optionalDependencies),
      stableJson(manifest.optionalDependencies),
      `optional dependency specs differ from the lockfile: ${relativePath}`,
    );
    checkedPackages += 1;
  }
}

assert.ok(checkedPackages > 0, 'no backend npm workspace packages were discovered');
console.log(`backend workspace contract verified: ${checkedPackages} package manifests, npm lockfile v${lock.lockfileVersion}, root pnpm boundary isolated`);
