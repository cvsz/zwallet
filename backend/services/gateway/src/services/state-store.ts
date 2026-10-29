import { randomUUID } from 'node:crypto';

type CacheLike = {
  get: (k: string) => Promise<string | null>;
  setex: (k: string, s: number, v: string) => Promise<unknown>;
  set: (k: string, v: string, mode?: string, duration?: string, condition?: string) => Promise<unknown>;
  eval: (script: string, numberOfKeys: number, ...args: string[]) => Promise<unknown>;
  lpush: (k: string, v: string) => Promise<number>;
  lrange: (k: string, start: number, stop: number) => Promise<string[]>;
  hget: (k: string, f: string) => Promise<string | null>;
  hset: (k: string, ...args: string[]) => Promise<number>;
  del: (k: string) => Promise<number>;
};

// Claim/replay is atomic. In-flight claims deliberately have no TTL: an expired lease
// must never let a second worker repeat a potentially completed external side effect.
export const IDEMPOTENCY_CLAIM_SCRIPT = `-- IDEMPOTENCY_CLAIM_V1
local existing = redis.call('GET', KEYS[2])
if existing then
  return {'REPLAY', existing}
end
local claimed = redis.call('SET', KEYS[1], ARGV[1], 'NX')
if claimed then
  return {'CLAIMED'}
end
return {'BUSY'}`;

export const IDEMPOTENCY_COMPLETE_SCRIPT = `-- IDEMPOTENCY_COMPLETE_V1
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('DEL', KEYS[1])
return 1`;

export type TxStep = { step: number; name: string; status: 'completed' | 'failed'; error?: string; txHash?: string };
export type TxLifecycleState = {
  id: string;
  userId: string;
  payload: Record<string, unknown>;
  steps: TxStep[];
  status: 'created' | 'failed' | 'confirmed';
  updatedBalances?: { from?: number; to?: number };
};

export class GatewayStateStore {
  constructor(private readonly redis: CacheLike) {}

  async withIdempotency<T>(key: string, ttlSec: number, run: () => Promise<T>): Promise<{ deduped: boolean; result: T }> {
    if (!key.trim()) throw new Error('invalid_idempotency_key');
    if (!Number.isSafeInteger(ttlSec) || ttlSec < 1) throw new Error('invalid_idempotency_ttl');

    const lockKey = `idem:${key}:lock`;
    const resultKey = `idem:${key}:result`;
    const ownerToken = randomUUID();
    const claim = await this.redis.eval(
      IDEMPOTENCY_CLAIM_SCRIPT,
      2,
      lockKey,
      resultKey,
      ownerToken
    ) as string[];

    if (claim[0] === 'REPLAY') {
      return { deduped: true, result: JSON.parse(claim[1]) as T };
    }
    if (claim[0] !== 'CLAIMED') throw new Error('idempotency_conflict');

    // A thrown/ambiguous handler intentionally leaves the non-expiring claim in place.
    // Recovery must reconcile the external side effect before an operator clears it.
    const result = await run();
    const serialized = JSON.stringify(result);
    if (serialized === undefined) throw new Error('idempotency_result_not_serializable');

    const completed = await this.redis.eval(
      IDEMPOTENCY_COMPLETE_SCRIPT,
      2,
      lockKey,
      resultKey,
      ownerToken,
      serialized,
      String(ttlSec)
    );
    if (Number(completed) !== 1) throw new Error('idempotency_lock_lost');

    return { deduped: false, result };
  }

  async createUser(email: string, password: string, deviceId: string) {
    const userId = randomUUID();
    await this.redis.hset(`user:${email}`, 'id', userId, 'email', email, 'password', password);
    await this.redis.hset(`devices:${userId}`, deviceId, '1');
    return { id: userId, email, password };
  }

  async getUser(email: string) {
    const id = await this.redis.hget(`user:${email}`, 'id');
    if (!id) return null;
    return { id, email: await this.redis.hget(`user:${email}`, 'email') ?? email, password: await this.redis.hget(`user:${email}`, 'password') ?? '' };
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
