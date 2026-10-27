import assert from 'node:assert/strict';
import test from 'node:test';
import { inventoryLegacyPasswordRecords, runCli } from '../scripts/inventory-legacy-passwords.mjs';

test('read-only inventory counts legacy and hashed records without returning keys', async () => {
  const pages = new Map([
    ['0', ['1', ['user:alice@example.invalid', 'user:bob@example.invalid']]],
    ['1', ['0', ['user:alice@example.invalid', 'user:carol@example.invalid', 'user:dave@example.invalid', 'user:erin@example.invalid']]],
  ]);
  const states = new Map([
    ['user:alice@example.invalid', { password: 1, password_hash: 0 }],
    ['user:bob@example.invalid', { password: 1, password_hash: 1 }],
    ['user:carol@example.invalid', { password: 0, password_hash: 1 }],
    ['user:dave@example.invalid', { password: 0, password_hash: 0 }],
    ['user:erin@example.invalid', { password: 1, password_hash: 0 }],
  ]);
  const commands = [];
  const redis = {
    async scan(cursor, ...args) {
      commands.push(['scan', cursor, ...args]);
      return pages.get(cursor);
    },
    async hexists(key, field) {
      commands.push(['hexists', key, field]);
      return states.get(key)[field];
    },
    async hget() { throw new Error('must not read credential values'); },
    async hset() { throw new Error('must not write'); },
    async del() { throw new Error('must not delete'); },
    async eval() { throw new Error('must not execute scripts'); },
  };

  const summary = await inventoryLegacyPasswordRecords(redis, { scanCount: 50, batchSize: 2 });
  assert.equal(summary.mode, 'read_only');
  assert.equal(summary.snapshot_consistent, false);
  assert.equal(summary.scanned_records, 5);
  assert.equal(summary.legacy_plaintext_only, 2);
  assert.equal(summary.mixed_legacy_and_hash, 1);
  assert.equal(summary.hashed_only, 1);
  assert.equal(summary.missing_credential_fields, 1);
  assert.equal(summary.legacy_plaintext_records, 3);
  assert.equal(JSON.stringify(summary).includes('@example.invalid'), false);
  assert.equal(commands.every(([command]) => command === 'scan' || command === 'hexists'), true);
  assert.equal(commands.filter(([command]) => command === 'scan').length, 2);
});

test('rejects unsafe scan options before touching Redis', async () => {
  let called = false;
  const redis = { async scan() { called = true; throw new Error('must not be called'); } };
  await assert.rejects(() => inventoryLegacyPasswordRecords(redis, { scanCount: 0 }), /invalid inventory options/);
  assert.equal(called, false);
});

test('CLI requires explicit read-only acknowledgement and never defaults a target', async () => {
  assert.equal(await runCli([], {}), 2);
  assert.equal(await runCli(['--confirm-read-only'], {}), 2);
});
