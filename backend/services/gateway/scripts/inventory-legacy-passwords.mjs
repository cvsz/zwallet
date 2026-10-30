import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const USER_KEY_PATTERN = 'user:*';
const DEFAULT_SCAN_COUNT = 500;
const DEFAULT_BATCH_SIZE = 25;

function boundedInteger(value, fallback, max) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error('invalid inventory options');
  }
  return parsed;
}

/**
 * Read-only aggregate inventory. Uses HEXISTS rather than HGET and never
 * returns Redis keys, email addresses, credential values, or hashes.
 */
export async function inventoryLegacyPasswordRecords(redis, options = {}) {
  const scanCount = boundedInteger(options.scanCount, DEFAULT_SCAN_COUNT, 2000);
  const batchSize = boundedInteger(options.batchSize, DEFAULT_BATCH_SIZE, 50);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const seenKeys = new Set();
  const counts = {
    legacy_plaintext_only: 0,
    mixed_legacy_and_hash: 0,
    hashed_only: 0,
    missing_credential_fields: 0,
  };

  let cursor = '0';
  do {
    const page = await redis.scan(cursor, 'MATCH', USER_KEY_PATTERN, 'COUNT', String(scanCount));
    if (!Array.isArray(page) || page.length !== 2 || typeof page[0] !== 'string' || !Array.isArray(page[1])) {
      throw new Error('invalid Redis SCAN response');
    }
    const [nextCursor, keys] = page;
    cursor = nextCursor;
    const freshKeys = [];
    for (const key of keys) {
      if (typeof key !== 'string') throw new Error('invalid Redis key response');
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      freshKeys.push(key);
    }

    for (let offset = 0; offset < freshKeys.length; offset += batchSize) {
      const batch = freshKeys.slice(offset, offset + batchSize);
      const states = await Promise.all(batch.map(async (key) => {
        const [legacyExists, hashExists] = await Promise.all([
          redis.hexists(key, 'password'),
          redis.hexists(key, 'password_hash'),
        ]);
        if (![0, 1].includes(legacyExists) || ![0, 1].includes(hashExists)) {
          throw new Error('invalid Redis HEXISTS response');
        }
        return { legacyExists: legacyExists === 1, hashExists: hashExists === 1 };
      }));

      for (const state of states) {
        if (state.legacyExists && state.hashExists) counts.mixed_legacy_and_hash += 1;
        else if (state.legacyExists) counts.legacy_plaintext_only += 1;
        else if (state.hashExists) counts.hashed_only += 1;
        else counts.missing_credential_fields += 1;
      }
    }
  } while (cursor !== '0');

  const completedAtMs = Date.now();
  return {
    schema_version: 1,
    mode: 'read_only',
    inventory_method: 'SCAN+HEXISTS',
    snapshot_consistent: false,
    started_at: startedAt,
    completed_at: new Date(completedAtMs).toISOString(),
    duration_ms: Math.max(0, completedAtMs - startedAtMs),
    scanned_records: seenKeys.size,
    ...counts,
    legacy_plaintext_records: counts.legacy_plaintext_only + counts.mixed_legacy_and_hash,
  };
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  if (!argv.includes('--confirm-read-only')) {
    console.error('Refusing to connect. Re-run with --confirm-read-only after verifying the target and read-only Redis ACL.');
    return 2;
  }
  if (!env.REDIS_URL) {
    console.error('REDIS_URL is required; no default Redis target is used.');
    return 2;
  }
  try {
    const url = new URL(env.REDIS_URL);
    if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('invalid protocol');
  } catch {
    console.error('REDIS_URL must be a valid redis:// or rediss:// URL; connection details are not printed.');
    return 2;
  }

  let redis;
  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    await redis.connect();
    const summary = await inventoryLegacyPasswordRecords(redis);
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  } catch {
    console.error('Inventory failed; connection/query details were suppressed to avoid exposing connection metadata or key names.');
    return 1;
  } finally {
    if (redis) redis.disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().then((code) => { process.exitCode = code; }).catch(() => {
    console.error('Inventory failed; details suppressed.');
    process.exitCode = 1;
  });
}
