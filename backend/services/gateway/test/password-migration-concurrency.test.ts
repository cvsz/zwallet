import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { GatewayStateStore } from '../src/services/state-store.js';
import { fakeRedis } from './helpers.js';

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

  it('removes stale plaintext when a hashed credential already exists', async () => {
    const redis = fakeRedis();
    const email = 'stale-plaintext@zwallet.dev';
    await redis.hset(
      `user:${email}`,
      'id', 'stale-plaintext-id',
      'email', email,
      'password_hash', 'scrypt$0123456789abcdef0123456789abcdef$' + 'a'.repeat(128),
      'password', 'old-plaintext-value',
    );

    const state = new GatewayStateStore(redis as any);
    const user = await state.getUser(email);
    expect(user?.passwordHash).toMatch(/^scrypt\$/);
    expect(user?.legacyPassword).toBeNull();
    expect(await redis.hget(`user:${email}`, 'password')).toBeNull();
  });
});
