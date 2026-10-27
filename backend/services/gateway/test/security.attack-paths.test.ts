import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { CardOrchestrator } from '../src/services/card/card-orchestrator.js';
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
    const handleAuth = vi.spyOn(CardOrchestrator.prototype, 'handleAuth').mockResolvedValue({ decision: 'approve' });
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
      expect(handleAuth).not.toHaveBeenCalled();
    } finally {
      await app.close();
      handleAuth.mockRestore();
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
  it('atomically rejects concurrent replays of a signed issuer webhook nonce', async () => {
    const previousWebhookSecret = process.env.ISSUER_WEBHOOK_SECRET;
    const previousJwtSecret = process.env.JWT_SECRET;
    const secret = 'synthetic-issuer-webhook-secret';
    const nonce = 'issuer-nonce-concurrent-1';
    process.env.ISSUER_WEBHOOK_SECRET = secret;
    process.env.JWT_SECRET = 'test-secret';
    const redis = fakeRedis();
    const handleAuth = vi.spyOn(CardOrchestrator.prototype, 'handleAuth').mockResolvedValue({ decision: 'approve' });
    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });
    const payload = {
      userId: '00000000-0000-4000-8000-000000000001',
      cardId: 'card-123456',
      amount: 1,
      currency: 'USD',
      mcc: '123',
      merchant: 'Test Merchant',
      authId: 'auth-123456',
    };
    const signature = createHmac('sha256', secret)
      .update(`${nonce}.${JSON.stringify(payload)}`)
      .digest('hex');
    const sendWebhook = (globalNonce: string) => app.inject({
      method: 'POST',
      url: '/v1/webhooks/issuer/auth',
      headers: {
        'x-nonce': globalNonce,
        'x-issuer-nonce': nonce,
        'x-issuer-signature': signature,
        'content-type': 'application/json',
      },
      payload,
    });

    try {
      const responses = await Promise.all([
        sendWebhook('global-issuer-concurrent-a'),
        sendWebhook('global-issuer-concurrent-b'),
      ]);
      expect(responses.map((response) => response.statusCode).sort((a, b) => a - b)).toEqual([200, 409]);
      const accepted = responses.find((response) => response.statusCode === 200);
      expect(accepted?.json()).toEqual({ decision: 'approve' });
      expect(handleAuth).toHaveBeenCalledTimes(1);
      expect(handleAuth).toHaveBeenCalledWith(payload);
      expect(await redis.get(`issuer:webhook:nonce:${nonce}`)).toBe('1');
    } finally {
      handleAuth.mockRestore();
      await app.close();
      if (previousWebhookSecret === undefined) delete process.env.ISSUER_WEBHOOK_SECRET;
      else process.env.ISSUER_WEBHOOK_SECRET = previousWebhookSecret;
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
    }
  });

  it('fails closed when the replay cache cannot atomically claim a nonce', async () => {
    const previousWebhookSecret = process.env.ISSUER_WEBHOOK_SECRET;
    const previousJwtSecret = process.env.JWT_SECRET;
    const secret = 'synthetic-issuer-webhook-secret';
    const nonce = 'issuer-nonce-no-atomic-cache';
    process.env.ISSUER_WEBHOOK_SECRET = secret;
    process.env.JWT_SECRET = 'test-secret';
    const redis = fakeRedis();
    const cacheWithoutAtomicClaim = { get: redis.get, setex: redis.setex };
    const app = buildApp({ rateLimiter: redis as any, cache: cacheWithoutAtomicClaim as any });
    const payload = {
      userId: '00000000-0000-4000-8000-000000000001',
      cardId: 'card-123456',
      amount: 1,
      currency: 'USD',
      mcc: '123',
      merchant: 'Test Merchant',
      authId: 'auth-123456',
    };
    const signature = createHmac('sha256', secret)
      .update(`${nonce}.${JSON.stringify(payload)}`)
      .digest('hex');

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/issuer/auth',
        headers: {
          'x-nonce': 'global-issuer-no-atomic-cache',
          'x-issuer-nonce': nonce,
          'x-issuer-signature': signature,
          'content-type': 'application/json',
        },
        payload,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'webhook_replay_protection_unavailable' });
    } finally {
      await app.close();
      if (previousWebhookSecret === undefined) delete process.env.ISSUER_WEBHOOK_SECRET;
      else process.env.ISSUER_WEBHOOK_SECRET = previousWebhookSecret;
      if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousJwtSecret;
    }
  });

});
