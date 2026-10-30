import { store } from '../src/utils/store.js';

export const fakeRedis = () => {
  const map = new Map<string, string>();
  const counter = new Map<string, number>();
  const hashes = new Map<string, Map<string, string>>();
  const lists = new Map<string, string[]>();

  return {
    get: async (k: string) => map.get(k) ?? counter.get(k)?.toString() ?? null,
    set: async (k: string, v: string, _mode?: string, _duration?: string, condition?: string) => {
      if (condition === 'NX' && (map.has(k) || counter.has(k) || hashes.has(k) || lists.has(k))) {
        return null;
      }
      map.set(k, v);
      return 'OK';
    },
    setex: async (k: string, _s: number, v: string) => { map.set(k, v); return 'OK'; },
    eval: async (script: string, numKeys: number, ...args: string[]) => {
      const keys = args.slice(0, numKeys);
      const argv = args.slice(numKeys);

      if (script.includes('IDEMPOTENCY_CLAIM_V1')) {
        const [lockKey, resultKey, fingerprintKey] = keys;
        const [ownerToken, fingerprint] = argv;
        const existing = map.get(resultKey);
        if (existing !== undefined) {
          return map.get(fingerprintKey) === fingerprint
            ? ['REPLAY', existing]
            : ['CONFLICT'];
        }
        if (map.has(lockKey)) {
          const storedFingerprint = map.get(fingerprintKey);
          return storedFingerprint !== undefined && storedFingerprint !== fingerprint
            ? ['CONFLICT']
            : ['BUSY'];
        }
        map.set(lockKey, ownerToken);
        map.set(fingerprintKey, fingerprint);
        return ['CLAIMED'];
      }

      if (script.includes('IDEMPOTENCY_COMPLETE_V1')) {
        const [lockKey, resultKey] = keys;
        const [ownerToken, serialized] = argv;
        if (map.get(lockKey) !== ownerToken) return 0;
        map.set(resultKey, serialized);
        map.delete(lockKey);
        return 1;
      }

      const key = keys[0];
      if (argv.length === 3) {
        if (hashes.has(key)) return 0;
        const [id, email, passwordHash] = argv;
        const h = new Map<string, string>();
        h.set('id', id);
        h.set('email', email);
        h.set('password_hash', passwordHash);
        hashes.set(key, h);
        return 1;
      }
      if (argv.length === 2) {
        const [legacyPassword, passwordHash] = argv;
        const h = hashes.get(key);
        if (!h || h.has('password_hash') || h.get('password') !== legacyPassword) return 0;
        h.set('password_hash', passwordHash);
        h.delete('password');
        return 1;
      }
      if (argv.length === 1) {
        const [expectedHash] = argv;
        const h = hashes.get(key);
        if (!h || h.get('password_hash') !== expectedHash) return 0;
        h.delete('password');
        return 1;
      }
      return 0;
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
    hmget: async (k: string, ...fields: string[]) => fields.map((field) => hashes.get(k)?.get(field) ?? null),
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

