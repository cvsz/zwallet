import { store } from '../src/utils/store.js';

export const fakeRedis = () => {
  const map = new Map<string, string>();
  const counter = new Map<string, number>();
  const hashes = new Map<string, Map<string, string>>();
  const lists = new Map<string, string[]>();

  return {
    get: async (k: string) => map.get(k) ?? counter.get(k)?.toString() ?? null,
    set: async (k: string, v: string, mode?: string, duration?: string) => {
      if (mode === 'EX' || mode === 'PX') {
        // Simple mock: if it exists, it's a "lock failure" for some patterns,
        // but here withIdempotency uses set(key, '1', 'EX', ttl) as a lock.
        // In ioredis, set(k, v, 'EX', t, 'NX') returns 'OK' or null.
        // The current state-store uses set(k, '1', 'EX', ttl) without NX.
        // Actually line 28 in state-store.ts: await this.redis.set(`idem:${key}:lock`, '1', 'EX', String(ttlSec));
        // It doesn't use NX! So it always succeeds unless it's a different implementation.
        // Wait, if it doesn't use NX, it's not a lock.
      }
      map.set(k, v);
      return 'OK';
    },
    setex: async (k: string, _s: number, v: string) => { map.set(k, v); return 'OK'; },
    eval: async (_script: string, _numKeys: number, key: string, legacyPassword: string, passwordHash: string) => {
      const h = hashes.get(key);
      if (!h || h.has('password_hash') || h.get('password') !== legacyPassword) return 0;
      h.set('password_hash', passwordHash);
      h.delete('password');
      return 1;
    },
    incr: async (k: string) => { const n = (counter.get(k) ?? 0) + 1; counter.set(k, n); return n; },
    expire: async () => 1,
    del: async (k: string) => { const existed = map.has(k) || counter.has(k); map.delete(k); counter.delete(k); return existed ? 1 : 0; },
    hset: async (k: string, ...args: string[]) => {
      let h = hashes.get(k);
      if (!h) { h = new Map(); hashes.set(k, h); }
      for (let i = 0; i < args.length; i += 2) {
        h.set(args[i], args[i+1]);
      }
      return args.length / 2;
    },
    hget: async (k: string, f: string) => hashes.get(k)?.get(f) ?? null,
    lpush: async (k: string, v: string) => {
      let l = lists.get(k);
      if (!l) { l = []; lists.set(k, l); }
      l.unshift(v);
      return l.length;
    },
    lrange: async (k: string, start: number, stop: number) => {
      const l = lists.get(k) ?? [];
      return l.slice(start, stop === -1 ? undefined : stop + 1);
    }
  };
};

export const resetStore = () => {
  store.users.clear();
  store.devices.clear();
  store.replayTokens.clear();
  store.wallets.length = 0;
  store.audit.length = 0;
  store.txIndex.length = 0;
  store.swaps.length = 0;
  store.balances.clear();
  store.lifecycleTx.clear();
};

export const registerAndLogin = async (app: any) => {
  await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { 'x-nonce': 'reg-nonce' }, payload: { email: 'test@zwallet.dev', password: 'password1', deviceId: 'device-12345678' } });
  const login = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { 'x-nonce': 'login-nonce' }, payload: { email: 'test@zwallet.dev', password: 'password1', deviceId: 'device-12345678' } });
  return login.json().accessToken as string;
};

