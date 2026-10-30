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
const problems = [];

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
for (const entry of overlappingRootEntries) {
  problems.push(`root pnpm workspace overlaps backend npm ownership: ${entry}`);
}

const backendManifest = readJson(path.join(backendRoot, 'package.json'));
const lock = readJson(path.join(backendRoot, 'package-lock.json'));
if (lock.lockfileVersion !== 3) {
  problems.push(`backend npm lockfile must be version 3 (found ${lock.lockfileVersion})`);
}
if (!Array.isArray(backendManifest.workspaces)) {
  problems.push('backend/package.json must declare npm workspaces');
}

const lockRoot = lock.packages?.[''];
if (!lockRoot) {
  problems.push('backend/package-lock.json must contain its root package entry');
}

const declaredWorkspaces = Array.isArray(backendManifest.workspaces) ? backendManifest.workspaces : [];
const lockedWorkspaces = Array.isArray(lockRoot?.workspaces) ? lockRoot.workspaces : [];
if (JSON.stringify([...lockedWorkspaces].sort()) !== JSON.stringify([...declaredWorkspaces].sort())) {
  problems.push('backend npm workspace globs differ between package.json and package-lock.json');
}

let checkedPackages = 0;
for (const pattern of declaredWorkspaces) {
  if (!/^(packages|services)\/\*$/.test(pattern)) {
    problems.push(`unsupported backend workspace pattern: ${pattern}`);
    continue;
  }

  const parent = path.join(backendRoot, pattern.slice(0, -2));
  if (!existsSync(parent)) {
    problems.push(`backend workspace directory is missing: ${pattern}`);
    continue;
  }

  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(parent, entry.name, 'package.json');
    if (!existsSync(manifestPath)) continue;

    const relativePath = path.posix.join(pattern.slice(0, -2), entry.name);
    const manifest = readJson(manifestPath);
    const locked = lock.packages?.[relativePath];
    checkedPackages += 1;

    if (!locked) {
      problems.push(`workspace package is absent from package-lock.json: ${relativePath}`);
      continue;
    }
    if (locked.name !== manifest.name) {
      problems.push(`workspace name mismatch: ${relativePath}`);
    }
    if ((locked.version ?? '0.0.0') !== (manifest.version ?? '0.0.0')) {
      problems.push(`workspace version mismatch: ${relativePath}`);
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (stableJson(locked[field]) !== stableJson(manifest[field])) {
        problems.push(`${field} specs differ from the lockfile: ${relativePath}`);
      }
    }
  }
}

if (checkedPackages === 0) {
  problems.push('no backend npm workspace packages were discovered');
}

if (problems.length > 0) {
  console.error(`backend workspace contract failed with ${problems.length} finding(s):`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log(`backend workspace contract verified: ${checkedPackages} package manifests, npm lockfile v${lock.lockfileVersion}, root pnpm boundary isolated`);
}
