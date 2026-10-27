import { describe, expect, it } from 'vitest';
import { GatewayStateStore } from '../src/services/state-store.js';
import { hashPassword } from '../src/services/password.js';
import { fakeRedis } from './helpers.js';

describe('GatewayStateStore password field migration', () => {
  it('removes a stale plaintext field atomically when rewriting a user record', async () => {
    const redis = fakeRedis();
    const email = 'existing@zwallet.dev';
    await redis.hset(`user:${email}`, 'id', 'legacy-id', 'email', email, 'password', 'legacy-password-123');

    const state = new GatewayStateStore(redis as any);
    const passwordHash = await hashPassword('replacement-password-123');
    await state.createUser(email, passwordHash, 'device-replacement-123');

    expect(await redis.hget(`user:${email}`, 'password')).toBeNull();
    expect(await redis.hget(`user:${email}`, 'password_hash')).toBe(passwordHash);
  });
});
