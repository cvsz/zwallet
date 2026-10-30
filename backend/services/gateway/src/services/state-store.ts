import { randomUUID } from 'node:crypto';

type CacheLike = {
  get: (k: string) => Promise<string | null>;
  setex: (k: string, s: number, v: string) => Promise<unknown>;
  set: (k: string, v: string, mode?: string, duration?: string, condition?: string) => Promise<unknown>;
  lpush: (k: string, v: string) => Promise<number>;
  lrange: (k: string, start: number, stop: number) => Promise<string[]>;
  hget: (k: string, f: string) => Promise<string | null>;
  hmget: (k: string, ...fields: string[]) => Promise<(string | null)[]>;
  hset: (k: string, ...args: string[]) => Promise<number>;
  del: (k: string) => Promise<number>;
  eval: (script: string, numKeys: number, ...args: string[]) => Promise<unknown>;
};

export type TxStep = { step: number; name: string; status: 'completed' | 'failed'; error?: string; txHash?: string };
export type TxLifecycleState = {
  id: string;
  userId: string;
  payload: Record<string, unknown>;
  steps: TxStep[];
  status: 'created' | 'failed' | 'confirmed';
  updatedBalances?: { from?: number; to?: number };
};

export const IDEMPOTENCY_CLAIM_SCRIPT = `-- IDEMPOTENCY_CLAIM_V1
local existing = redis.call('GET', KEYS[2])
local existingFingerprint = redis.call('GET', KEYS[3])
if existing then
  if existingFingerprint ~= ARGV[2] then return {'CONFLICT'} end
  return {'REPLAY', existing}
end
local claimed = redis.call('SET', KEYS[1], ARGV[1], 'NX')
if claimed then
  redis.call('SET', KEYS[3], ARGV[2])
  return {'CLAIMED'}
end
if existingFingerprint and existingFingerprint ~= ARGV[2] then return {'CONFLICT'} end
return {'BUSY'}`;

export const IDEMPOTENCY_COMPLETE_SCRIPT = `-- IDEMPOTENCY_COMPLETE_V1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('EXPIRE', KEYS[3], ARGV[3])
redis.call('DEL', KEYS[1])
return 1`;

export class GatewayStateStore {
  constructor(private readonly redis: CacheLike) {}

  async withIdempotency<T>(
    key: string,
    ttlSec: number,
    run: () => Promise<T>,
    fingerprint = '',
  ): Promise<{ deduped: boolean; result: T }> {
    if (!key.trim()) throw new Error('invalid_idempotency_key');
    if (!Number.isSafeInteger(ttlSec) || ttlSec < 1) throw new Error('invalid_idempotency_ttl');
    if (typeof fingerprint !== 'string' || fingerprint.length > 256) {
      throw new Error('invalid_idempotency_fingerprint');
    }

    const lockKey = `idem:${key}:lock`;
    const resultKey = `idem:${key}:result`;
    const fingerprintKey = `idem:${key}:fingerprint`;
    const ownerToken = randomUUID();
    const claim = await this.redis.eval(
      IDEMPOTENCY_CLAIM_SCRIPT,
      3,
      lockKey,
      resultKey,
      fingerprintKey,
      ownerToken,
      fingerprint,
    ) as string[];

    if (claim[0] === 'REPLAY') {
      return { deduped: true, result: JSON.parse(claim[1]) as T };
    }
    if (claim[0] === 'CONFLICT') throw new Error('idempotency_payload_conflict');
    if (claim[0] !== 'CLAIMED') throw new Error('idempotency_conflict');

    // An ambiguous failure leaves the non-expiring claim in place; an operator must
    // reconcile the side effect before clearing it. This avoids duplicate execution.
    const result = await run();
    const serialized = JSON.stringify(result);
    if (serialized === undefined) throw new Error('idempotency_result_not_serializable');

    const completed = await this.redis.eval(
      IDEMPOTENCY_COMPLETE_SCRIPT,
      3,
      lockKey,
      resultKey,
      fingerprintKey,
      ownerToken,
      serialized,
      String(ttlSec),
    );
    if (Number(completed) !== 1) throw new Error('idempotency_lock_lost');

    return { deduped: false, result };
  }

  async createUser(email: string, passwordHash: string, deviceId: string): Promise<{ id: string; email: string } | null> {
    const userId = randomUUID();
    const script = `
      if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
      if redis.call('EXISTS', KEYS[2]) == 1 then
        return redis.error_reply('device_binding_conflict')
      end
      redis.call('HSET', KEYS[2], ARGV[4], '1')
      redis.call('HSET', KEYS[1], 'id', ARGV[1], 'email', ARGV[2], 'password_hash', ARGV[3])
      return 1
    `;
    const created = Number(await this.redis.eval(
      script,
      2,
      `user:${email}`,
      `devices:${userId}`,
      userId,
      email,
      passwordHash,
      deviceId,
    )) === 1;
    if (!created) return null;
    return { id: userId, email };
  }

  async getUser(email: string) {
    const key = `user:${email}`;
    let fields = await this.redis.hmget(key, 'id', 'email', 'password_hash', 'password');
    if (!fields[0]) return null;

    // Retry once if a concurrent legacy-password migration changed the record between reads.
    if (!fields[2] && fields[3] === null) {
      fields = await this.redis.hmget(key, 'id', 'email', 'password_hash', 'password');
      if (!fields[0]) return null;
    }

    const [id, storedEmail, passwordHash, legacyPassword] = fields;
    if (!id) return null;

    return {
      id,
      email: storedEmail ?? email,
      passwordHash,
      legacyPassword,
    };
  }

  async removeLegacyPasswordAfterHashAuthentication(email: string, expectedPasswordHash: string): Promise<boolean> {
    if (!expectedPasswordHash) return false;
    const script = `
      if redis.call('HGET', KEYS[1], 'password_hash') ~= ARGV[1] then return 0 end
      redis.call('HDEL', KEYS[1], 'password')
      return 1
    `;
    return Number(await this.redis.eval(script, 1, `user:${email}`, expectedPasswordHash)) === 1;
  }

  async migrateLegacyPassword(email: string, legacyPassword: string, passwordHash: string): Promise<boolean> {
    const script = `
      if redis.call('HGET', KEYS[1], 'password_hash') then return 0 end
      if redis.call('HGET', KEYS[1], 'password') ~= ARGV[1] then return 0 end
      redis.call('HSET', KEYS[1], 'password_hash', ARGV[2])
      redis.call('HDEL', KEYS[1], 'password')
      return 1
    `;
    return Number(await this.redis.eval(script, 1, `user:${email}`, legacyPassword, passwordHash)) === 1;
  }

  async bindDevice(userId: string, deviceId: string) { await this.redis.hset(`devices:${userId}`, deviceId, '1'); }
  async hasDevice(userId: string, deviceId: string) { return (await this.redis.hget(`devices:${userId}`, deviceId)) === '1'; }
  async appendAudit(action: string, userId: string | undefined, payload: Record<string, unknown>) { await this.redis.lpush('audit:logs', JSON.stringify({ id: randomUUID(), action, userId, payload, createdAt: new Date().toISOString() })); }
  async readAudit(limit = 200) { return (await this.redis.lrange('audit:logs', 0, limit - 1)).map((v) => JSON.parse(v)); }

  async writeTxLifecycle(txId: string, state: TxLifecycleState) {
    await this.redis.setex(`tx:lifecycle:${txId}`, 86400, JSON.stringify(state));
  }

  async readTxLifecycle(txId: string): Promise<TxLifecycleState | null> {
    const item = await this.redis.get(`tx:lifecycle:${txId}`);
    if (!item) return null;
    return JSON.parse(item) as TxLifecycleState;
  }
}
