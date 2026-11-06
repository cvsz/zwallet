import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workerSource = await readFile(
  new URL('../src/index.ts', import.meta.url),
  'utf8',
);

test('transaction requests cannot publish execution-success events', () => {
  assert.doesNotMatch(workerSource, /Events\.TX_EXECUTED/);
  assert.match(workerSource, /Events\.TX_FAILED/);
});

test('swap requests cannot publish execution-success events', () => {
  assert.doesNotMatch(workerSource, /Events\.SWAP_EXECUTED/);
  assert.match(workerSource, /Events\.SWAP_FAILED/);
});

test('disabled execution is reported as a failed result with an explicit reason code', () => {
  assert.match(workerSource, /status:\s*'failed'/);
  assert.match(workerSource, /code:\s*'EXECUTION_DISABLED'/);
  assert.match(workerSource, /verified signer/);
  assert.match(workerSource, /chain-finality reconciler/);
});

test('synthetic route selection is not used by the event worker', () => {
  assert.doesNotMatch(workerSource, /fakeRoutes|selectBestRoute|RouteCandidate/);
});
