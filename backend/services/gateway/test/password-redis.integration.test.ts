import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { GatewayStateStore } from '../src/services/state-store.js';
import { hashPassword } from '../src/services/password.js';

const redisUrl = process.env.REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;
const originalJwtSecret = process.env.JWT_SECRET;

describeWithRedis('gateway password storage with real Redis', () => {
  let redis: Redis | undefined;
  let state: GatewayStateStore;
  const createEmail = `ci-create-${randomUUID()}@example.test`;
  const migrationEmail = `ci-migrate-${randomUUID()}@example.test`;
  const staleEmail = `ci-stale-${randomUUID()}@example.test`;

  beforeAll(async () => {
    redis = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    await redis.connect();
    state = new GatewayStateStore(redis as any);
    process.env.JWT_SECRET = 'test-only-gateway-secret';
  });

  afterAll(async () => {
    if (redis) {
      for (const email of [createEmail, migrationEmail, staleEmail]) {
        const userId = await redis.hget(`user:${email}`, 'id');
        await redis.del(`user:${email}`);
        if (userId) await redis.del(`devices:${userId}`);
      }
      await redis.quit();
    }
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  it('atomically replaces legacy fields when creating a user', async () => {
    await redis!.hset(
      `user:${createEmail}`,
      'id', 'old-user-id',
      'email', createEmail,
      'password', 'legacy-plaintext',
    );

    const created = await state.createUser(createEmail, 'scrypt$integration-test-hash', 'device-create');
    const [storedId, storedEmail, passwordHash, legacyPassword] = await redis!.hmget(
      `user:${createEmail}`, 'id', 'email', 'password_hash', 'password',
    );

    expect(storedId).toBe(created.id);
    expect(storedEmail).toBe(createEmail);
    expect(passwordHash).toBe('scrypt$integration-test-hash');
    expect(legacyPassword).toBeNull();
    expect(await redis!.hget(`devices:${created.id}`, 'device-create')).toBe('1');
  });

  it('allows only one concurrent compare-and-set migration to win', async () => {
    const legacyPassword = 'legacy-password-for-integration';
    await redis!.hset(
      `user:${migrationEmail}`,
      'id', 'legacy-integration-user',
      'email', migrationEmail,
      'password', legacyPassword,
    );

    const [firstHash, secondHash] = await Promise.all([
      hashPassword(legacyPassword),
      hashPassword(legacyPassword),
    ]);
    const outcomes = await Promise.all([
      state.migrateLegacyPassword(migrationEmail, legacyPassword, firstHash),
      state.migrateLegacyPassword(migrationEmail, legacyPassword, secondHash),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const [storedHash, storedPassword] = await redis!.hmget(
      `user:${migrationEmail}`, 'password_hash', 'password',
    );
    expect([firstHash, secondHash]).toContain(storedHash);
    expect(storedPassword).toBeNull();
  });

  it('cleans stale plaintext from a record that already has a hash', async () => {
    const passwordHash = await hashPassword('existing-hash-password');
    await redis!.hset(
      `user:${staleEmail}`,
      'id', 'stale-integration-user',
      'email', staleEmail,
      'password_hash', passwordHash,
      'password', 'must-be-removed',
    );

    const user = await state.getUser(staleEmail);

    expect(user?.passwordHash).toBe(passwordHash);
    expect(user?.legacyPassword).toBeNull();
    expect(await redis!.hget(`user:${staleEmail}`, 'password')).toBeNull();
  });

  it('rejects concurrent duplicate registrations without overwriting credentials or binding the losing device', async () => {
    const email = `ci-duplicate-${randomUUID()}@example.test`;
    const passwordA = 'first-password-123';
    const passwordB = 'second-password-456';
    const deviceA = `device-${randomUUID()}`;
    const deviceB = `device-${randomUUID()}`;
    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });

    try {
      const [responseA, responseB] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/v1/auth/register',
          headers: { 'idempotency-key': `registration-${randomUUID()}` },
          payload: { email, password: passwordA, deviceId: deviceA },
        }),
        app.inject({
          method: 'POST',
          url: '/v1/auth/register',
          headers: { 'idempotency-key': `registration-${randomUUID()}` },
          payload: { email, password: passwordB, deviceId: deviceB },
        }),
      ]);

      expect([responseA.statusCode, responseB.statusCode].sort()).toEqual([200, 409]);
      const user = await state.getUser(email);
      expect(user?.passwordHash).toMatch(/^scrypt\\$/);
      expect(user?.legacyPassword).toBeNull();

      const [loginA, loginB] = await Promise.all([
        app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: passwordA, deviceId: deviceA } }),
        app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password: passwordB, deviceId: deviceB } }),
      ]);
      expect([loginA.statusCode, loginB.statusCode].sort()).toEqual([200, 401]);

      const winningDevice = loginA.statusCode === 200 ? deviceA : deviceB;
      const losingDevice = loginA.statusCode === 200 ? deviceB : deviceA;
      expect(await redis!.hget(`devices:${user!.id}`, winningDevice)).toBe('1');
      expect(await redis!.hget(`devices:${user!.id}`, losingDevice)).toBeNull();
    } finally {
      const userId = await redis!.hget(`user:${email}`, 'id');
      await app.close();
      if (userId) await redis!.del(`devices:${userId}`);
      await redis!.del(`user:${email}`);
    }
  });

  it('allows concurrent successful legacy logins to converge on one hash', async () => {
    const email = `ci-login-${randomUUID()}@example.test`;
    const userId = randomUUID();
    const password = 'legacy-concurrent-password';
    const deviceId = `device-${randomUUID()}`;
    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });

    try {
      await redis!.hset(`user:${email}`, 'id', userId, 'email', email, 'password', password);
      await redis!.hset(`devices:${userId}`, deviceId, '1');

      const login = (nonce: string) => app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-nonce': nonce },
        payload: { email, password, deviceId },
      });
      const responses = await Promise.all([login(randomUUID()), login(randomUUID())]);

      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(await redis!.hget(`user:${email}`, 'password')).toBeNull();
      expect(await redis!.hget(`user:${email}`, 'password_hash')).toMatch(/^scrypt\$/);
    } finally {
      await app.close();
      await redis!.del(`user:${email}`, `devices:${userId}`);
    }
  });
});
