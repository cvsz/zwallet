import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function readRepositoryFile(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
}

test("event worker is held before connecting, subscribing, publishing, or acknowledging", () => {
  const source = readRepositoryFile("services/event-workers/src/index.ts");
  const executableSource = stripComments(source);

  assert.match(source, /EXECUTION_DISABLED/);
  for (const forbidden of [
    /createEventBusFromEnv/,
    /TX_EXECUTED/,
    /SWAP_EXECUTED/,
    /fakeRoutes/,
    /\.connect\s*\(/,
    /\.subscribe\s*\(/,
    /\.publish\s*\(/,
  ]) {
    assert.doesNotMatch(executableSource, forbidden);
  }
});

test("wallet transfer worker cannot create a production queue consumer or sign/broadcast", () => {
  const worker = readRepositoryFile("services/wallet-engine/src/workers/transferWorker.ts");
  assert.match(worker, /enabled:\s*false/);
  assert.match(worker, /execution_not_configured/);
  for (const forbidden of [
    /new\s+Worker\s*\(/,
    /createRedisConnection/,
    /allocateNonce/,
    /getSigningKeyForAddress/,
    /signTransfer/,
    /broadcastTransfer/,
    /markPendingConfirmed/,
  ]) {
    assert.doesNotMatch(worker, forbidden);
  }

  const runner = readRepositoryFile("services/wallet-engine/src/runTransferWorker.ts");
  assert.match(runner, /transferExecutionStatus\.state/);
  assert.match(runner, /transferExecutionStatus\.reason/);
  assert.doesNotMatch(runner, /setInterval/);
  assert.doesNotMatch(runner, /transfer worker online/i);
});

test("production compose does not start the synthetic event worker", () => {
  const compose = readRepositoryFile("infra/docker/docker-compose.prod.yml");
  assert.doesNotMatch(compose, /^\s{2}event-workers:/m);
});

test("Prometheus does not scrape the removed event-worker service", () => {
  const prometheus = readRepositoryFile("infra/docker/prometheus/prometheus.yml");
  assert.doesNotMatch(prometheus, /event-workers:8100/);
});
