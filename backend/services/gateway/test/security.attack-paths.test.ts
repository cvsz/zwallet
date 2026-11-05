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

  it('blocks sandbox MPC and account-abstraction operations in production before side effects', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WALLET_ENABLE_SANDBOX_MPC_AA', 'true');
    vi.stubEnv('JWT_SECRET', 'test-secret');

    const cache = fakeRedis();
    const app = buildApp({ rateLimiter: cache as any, cache: cache as any });
    await app.ready();
    const token = await app.jwt.sign({ sub: 'user-1', deviceId: 'device-1', typ: 'access' });
    const headers = (nonce: string) => ({
      authorization: `Bearer ${token}`,
      'x-nonce': nonce,
    });

    const mpc = await app.inject({
      method: 'POST',
      url: '/v1/mpc/sign-transaction',
      headers: headers('production-sandbox-mpc'),
      payload: {
        payload: '0x1234',
        threshold: 2,
        participants: ['participant-a'],
        attestationToken: 'test-attestation-token',
      },
    });
    const userOperation = await app.inject({
      method: 'POST',
      url: '/v1/aa/user-operations',
      headers: headers('production-sandbox-aa'),
      payload: { idempotencyKey: 'test-operation', chainId: 1, sender: '0x12345', nonce: 0, callData: '0x01' },
    });
    const status = await app.inject({
      method: 'GET',
      url: '/v1/aa/user-operations/0xop_fake/status',
      headers: headers('production-sandbox-aa-status'),
    });

    for (const response of [mpc, userOperation, status]) {
      expect(response.statusCode).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ error: 'sandbox_mpc_aa_disabled' });
    }
    expect(await cache.lrange('audit:logs', 0, -1)).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();

    await app.close();
  });

  it('keeps sandbox MPC and account-abstraction routes available only with explicit test opt-in', async () => {
    vi.stubEnv('WALLET_ENABLE_SANDBOX_MPC_AA', 'true');
    vi.stubEnv('JWT_SECRET', 'test-secret');

    const cache = fakeRedis();
    const app = buildApp({ rateLimiter: cache as any, cache: cache as any });
    await app.ready();
    const token = await app.jwt.sign({ sub: 'user-1', deviceId: 'device-1', typ: 'access' });
    const headers = (nonce: string) => ({
      authorization: `Bearer ${token}`,
      'x-nonce': nonce,
    });

    const mpc = await app.inject({
      method: 'POST',
      url: '/v1/mpc/sign-transaction',
      headers: headers('test-sandbox-mpc'),
      payload: {
        payload: '0x1234',
        threshold: 2,
        participants: ['participant-a'],
        attestationToken: 'test-attestation-token',
      },
    });
    const userOperation = await app.inject({
      method: 'POST',
      url: '/v1/aa/user-operations',
      headers: headers('test-sandbox-aa'),
      payload: { idempotencyKey: 'test-operation', chainId: 1, sender: '0x12345', nonce: 0, callData: '0x01' },
    });

    expect(mpc.statusCode).toBe(200);
    expect(mpc.json().status).toBe('initiated');
    expect(userOperation.statusCode).toBe(200);
    expect(userOperation.json().status).toBe('submitted');
    expect(await cache.lrange('audit:logs', 0, -1)).toHaveLength(2);

    await app.close();
  });


  it('scopes audit log reads to the authenticated user', async () => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    const cache = fakeRedis();
    await cache.lpush('audit:logs', JSON.stringify({
      id: 'audit-user-2',
      action: 'card.issue',
      userId: 'user-2',
      payload: { cardId: 'card-user-2' },
      createdAt: '2026-10-30T00:00:00.000Z',
    }));
    await cache.lpush('audit:logs', JSON.stringify({
      id: 'audit-system',
      action: 'system.maintenance',
      userId: undefined,
      payload: { detail: 'internal' },
      createdAt: '2026-10-30T00:00:00.000Z',
    }));
    await cache.lpush('audit:logs', JSON.stringify({
      id: 'audit-user-1',
      action: 'wallet.read',
      userId: 'user-1',
      payload: { walletId: 'wallet-user-1' },
      createdAt: '2026-10-30T00:00:00.000Z',
    }));

    const app = buildApp({ rateLimiter: cache as any, cache: cache as any });
    await app.ready();
    const token = await app.jwt.sign({ sub: 'user-1', deviceId: 'device-1', typ: 'access' });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/audit-logs',
      headers: {
        authorization: `Bearer ${token}`,
        'x-nonce': 'audit-user-scope',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0].userId).toBe('user-1');
    expect(JSON.stringify(response.json())).not.toContain('card-user-2');
    expect(JSON.stringify(response.json())).not.toContain('internal');

    await app.close();
  });

});
