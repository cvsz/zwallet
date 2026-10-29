import { IDEMPOTENCY_CLAIM_SCRIPT, IDEMPOTENCY_COMPLETE_SCRIPT } from '../src/services/state-store.js';
import { store } from '../src/utils/store.js';

export const fakeRedis = () => {
  const map = new Map<string, string>();
  const expiries = new Map<string, number>();
  const counter = new Map<string, number>();
  const hashes = new Map<string, Map<string, string>>();
  const lists = new Map<string, string[]>();

  const read = (k: string) => {
    const expiresAt = expiries.get(k);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      map.delete(k);
      expiries.delete(k);
    }
    return map.get(k) ?? counter.get(k)?.toString() ?? null;
  };

  const exists = (k: string) => read(k) !== null || hashes.has(k) || lists.has(k);

  return {
    get: async (k: string) => read(k),
    set: async (k: string, v: string, _mode?: string, _duration?: string, condition?: string) => {
      if (condition === 'NX' && exists(k)) return null;
      map.set(k, v);
      expiries.delete(k);
      return 'OK';
    },
    setex: async (k: string, seconds: number, v: string) => {
      map.set(k, v);
      expiries.set(k, Date.now() + seconds * 1000);
      return 'OK';
    },
    eval: async (script: string, numberOfKeys: number, ...args: string[]) => {
      const keys = args.slice(0, numberOfKeys);
      const argv = args.slice(numberOfKeys);
      const [lockKey, resultKey] = keys;

      if (script === IDEMPOTENCY_CLAIM_SCRIPT) {
        const existing = read(resultKey);
        if (existing !== null) return ['REPLAY', existing];
        if (read(lockKey) !== null) return ['BUSY'];
        map.set(lockKey, argv[0]);
        expiries.delete(lockKey);
        return ['CLAIMED'];
      }

      if (script === IDEMPOTENCY_COMPLETE_SCRIPT) {
        if (read(lockKey) !== argv[0]) return 0;
        map.set(resultKey, argv[1]);
        expiries.set(resultKey, Date.now() + Number(argv[2]) * 1000);
        map.delete(lockKey);
        expiries.delete(lockKey);
        return 1;
      }

      throw new Error('unsupported_fake_redis_script');
    },
    incr: async (k: string) => { const n = (counter.get(k) ?? 0) + 1; counter.set(k, n); return n; },
    expire: async () => 1,
    del: async (k: string) => {
      const existed = read(k) !== null || counter.has(k);
      map.delete(k);
      expiries.delete(k);
      counter.delete(k);
      return existed ? 1 : 0;
    },
    hset: async (k: string, ...args: string[]) => {
      let h = hashes.get(k);
      if (!h) { h = new Map(); hashes.set(k, h); }
      for (let i = 0; i < args.length; i += 2) {
        h.set(args[i], args[i + 1]);
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
