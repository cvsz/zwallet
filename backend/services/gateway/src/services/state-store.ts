import { randomUUID } from 'node:crypto';

type CacheLike = {
  get: (k: string) => Promise<string | null>;
  setex: (k: string, s: number, v: string) => Promise<unknown>;
  set: (k: string, v: string, mode?: string, cond?: string) => Promise<unknown>;
  lpush: (k: string, v: string) => Promise<number>;
  lrange: (k: string, start: number, stop: number) => Promise<string[]>;
  hget: (k: string, f: string) => Promise<string | null>;
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

export class GatewayStateStore {
  constructor(private readonly redis: CacheLike) {}

  async withIdempotency<T>(key: string, ttlSec: number, run: () => Promise<T>): Promise<{ deduped: boolean; result: T }> {
    const lock = await this.redis.set(`idem:${key}:lock`, '1', 'EX', String(ttlSec));
    if (lock === null) {
      const existing = await this.redis.get(`idem:${key}:result`);
      if (!existing) throw new Error('idempotency_conflict');
      return { deduped: true, result: JSON.parse(existing) as T };
    }
    const result = await run();
    await this.redis.setex(`idem:${key}:result`, ttlSec, JSON.stringify(result));
    return { deduped: false, result };
  }

  async createUser(email: string, passwordHash: string, deviceId: string) {
    const userId = randomUUID();
    const script = `
      redis.call('HSET', KEYS[1], 'id', ARGV[1], 'email', ARGV[2], 'password_hash', ARGV[3])
      redis.call('HDEL', KEYS[1], 'password')
      return 1
    `;
    await this.redis.eval(script, 1, `user:${email}`, userId, email, passwordHash);
    await this.redis.hset(`devices:${userId}`, deviceId, '1');
    return { id: userId, email };
  }

  async getUser(email: string) {
    const id = await this.redis.hget(`user:${email}`, 'id');
    if (!id) return null;
    return {
      id,
      email: await this.redis.hget(`user:${email}`, 'email') ?? email,
      passwordHash: await this.redis.hget(`user:${email}`, 'password_hash'),
      legacyPassword: await this.redis.hget(`user:${email}`, 'password'),
    };
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
