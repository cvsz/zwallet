import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakeRedis, registerAndLogin, resetStore } from './helpers.js';

describe('security attack paths', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
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

  it('fails closed when the issuer webhook secret is missing or whitespace-only', async () => {
    const previousWebhookSecret = process.env.ISSUER_WEBHOOK_SECRET;
    const previousJwtSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-secret';
    const app = buildApp({ rateLimiter: fakeRedis() as any, cache: fakeRedis() as any });
    const secretCases: Array<string | undefined> = [undefined, '', '   ', '\t\n'];

    try {
      for (const [index, secret] of secretCases.entries()) {
        if (secret === undefined) {
          delete process.env.ISSUER_WEBHOOK_SECRET;
        } else {
          process.env.ISSUER_WEBHOOK_SECRET = secret;
        }

        const response = await app.inject({
          method: 'POST',
          url: '/v1/webhooks/issuer/auth',
          headers: {
            'x-nonce': `global-webhook-secret-${index}`,
            'x-issuer-nonce': `issuer-webhook-secret-${index}`,
            'x-issuer-signature': '0'.repeat(64),
          },
          payload: {},
        });

        expect(response.statusCode).toBe(503);
        expect(response.json()).toEqual({ error: 'webhook_unavailable' });
      }
    } finally {
      await app.close();
      if (previousWebhookSecret === undefined) delete process.env.ISSUER_WEBHOOK_SECRET;
      else process.env.ISSUER_WEBHOOK_SECRET = previousWebhookSecret;
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
    }
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
