import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakeRedis, registerAndLogin, resetStore } from './helpers.js';

describe('security attack paths', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WALLET_ENABLE_TRANSACTION_LIFECYCLE_SIMULATION', 'true');
    resetStore();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/tx/verify-signature')) {
        return { ok: false, json: async () => ({ verified: false, error: 'Invalid signature' }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it('health endpoint remains public without nonce anti-replay enforcement', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const app = buildApp({ rateLimiter: fakeRedis() as any, cache: fakeRedis() as any });

    const first = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-nonce': 'nonce-replay-1' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-nonce': 'nonce-replay-1' },
    });
    expect(second.statusCode).toBe(200);

    await app.close();
  });

  it('invalid signature must fail before broadcast', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const app = buildApp({ rateLimiter: fakeRedis() as any, cache: fakeRedis() as any });
    const accessToken = await registerAndLogin(app);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/transactions/lifecycle',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-nonce': 'nonce-invalid-sig',
      },
      payload: {
        chain: 'evm',
        from: '0xsenderabc',
        to: '0xreceiverabc',
        value: '10',
        signatureHex: 'abcdef123456',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_signature');

    await app.close();
  });
});
