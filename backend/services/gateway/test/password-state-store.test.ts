import { describe, expect, it } from 'vitest';
import { GatewayStateStore } from '../src/services/state-store.js';
import { fakeRedis } from './helpers.js';

describe('GatewayStateStore account creation', () => {
  it('creates the user and initial device binding in one Redis script', async () => {
    const redis = fakeRedis();
    redis.hset = async () => { throw new Error('out_of_band_hset_called'); };
    const state = new GatewayStateStore(redis as any);

    const created = await state.createUser(
      'atomic-create@zwallet.dev',
      'scrypt$test-hash',
      'atomic-device-123',
    );

    expect(created).not.toBeNull();
    expect(await redis.hget(`user:atomic-create@zwallet.dev`, 'password_hash')).toBe('scrypt$test-hash');
    expect(await redis.hget(`devices:${created!.id}`, 'atomic-device-123')).toBe('1');
  });

  it('does not overwrite an existing user identity or credential', async () => {
    const redis = fakeRedis();
    const email = 'existing@zwallet.dev';
    const existingHash = `scrypt$${'a'.repeat(32)}$${'b'.repeat(128)}`;
    await redis.hset(`user:${email}`, 'id', 'existing-user-id', 'email', email, 'password_hash', existingHash);
    await redis.hset('devices:existing-user-id', 'existing-device-123', '1');

    const state = new GatewayStateStore(redis as any);
    const created = await state.createUser(email, 'scrypt$' + 'c'.repeat(32) + '$' + 'd'.repeat(128), 'new-device-123');

    expect(created).toBeNull();
    expect(await redis.hget(`user:${email}`, 'id')).toBe('existing-user-id');
    expect(await redis.hget(`user:${email}`, 'password_hash')).toBe(existingHash);
    expect(await state.hasDevice('existing-user-id', 'existing-device-123')).toBe(true);
    expect(await state.hasDevice('existing-user-id', 'new-device-123')).toBe(false);
  });
});
