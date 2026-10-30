import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { GatewayStateStore } from '../src/services/state-store.js';
import { fakeRedis } from './helpers.js';
import { hashPassword } from '../src/services/password.js';

const originalJwtSecret = process.env.JWT_SECRET;
beforeEach(() => { process.env.JWT_SECRET = 'test-secret'; });
afterEach(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

describe('legacy password migration concurrency', () => {
  it('converges concurrent successful sign-ins on one hashed credential', async () => {
    const redis = fakeRedis();
    const email = 'legacy-concurrent@zwallet.dev';
    const password = 'legacy-password-123';
    const deviceId = 'legacy-concurrent-device';
    await redis.hset(`user:${email}`, 'id', 'legacy-concurrent-id', 'email', email, 'password', password);
    await redis.hset('devices:legacy-concurrent-id', deviceId, '1');

    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });
    const makeLogin = (nonce: string) => app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-nonce': nonce },
      payload: { email, password, deviceId },
    });

    const responses = await Promise.all([makeLogin('legacy-concurrent-a'), makeLogin('legacy-concurrent-b')]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(await redis.hget(`user:${email}`, 'password')).toBeNull();
    expect(await redis.hget(`user:${email}`, 'password_hash')).toMatch(/^scrypt\$/);
    await app.close();
  });

  it('removes legacy plaintext only after successful hash authentication', async () => {
    const redis = fakeRedis();
    const email = 'stale-plaintext@zwallet.dev';
    const password = 'existing-hash-password';
    const userId = 'stale-plaintext-id';
    const deviceId = 'stale-plaintext-device';
    const passwordHash = await hashPassword(password);
    await redis.hset(
      `user:${email}`,
      'id', userId,
      'email', email,
      'password_hash', passwordHash,
      'password', password,
    );
    await redis.hset(`devices:${userId}`, deviceId, '1');

    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, password, deviceId },
      });
      expect(response.statusCode).toBe(200);
      expect(await redis.hget(`user:${email}`, 'password')).toBeNull();
      expect(await redis.hget(`user:${email}`, 'password_hash')).toBe(passwordHash);
    } finally {
      await app.close();
    }
  });

  it('preserves legacy plaintext when the stored password hash is malformed', async () => {
    const redis = fakeRedis();
    const email = 'malformed-hash@zwallet.dev';
    const password = 'recoverable-legacy-password';
    const userId = 'malformed-hash-user';
    const deviceId = 'malformed-hash-device';
    await redis.hset(
      `user:${email}`,
      'id', userId,
      'email', email,
      'password_hash', 'invalid-scrypt-hash',
      'password', password,
    );
    await redis.hset(`devices:${userId}`, deviceId, '1');

    const state = new GatewayStateStore(redis as any);
    const user = await state.getUser(email);
    expect(user?.legacyPassword).toBe(password);
    expect(await redis.hget(`user:${email}`, 'password')).toBe(password);

    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email, password, deviceId },
      });
      expect(response.statusCode).toBe(401);
      expect(await redis.hget(`user:${email}`, 'password')).toBe(password);
    } finally {
      await app.close();
    }
  });
});
