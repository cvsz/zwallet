import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { GatewayStateStore } from '../src/services/state-store.js';
import { hashPassword, verifyPassword } from '../src/services/password.js';
import { registerSchema, loginSchema } from '../src/schemas/index.js';
import { fakeRedis } from './helpers.js';

const originalJwtSecret = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret';
});

afterEach(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

describe('gateway password storage', () => {
  it('rejects passwords over 1024 characters before invoking password hashing', () => {
    const payload = {
      email: 'overlong-password@zwallet.dev',
      password: 'x'.repeat(1025),
      deviceId: 'device-overlong-password',
    };

    expect(registerSchema.safeParse(payload).success).toBe(false);
    expect(loginSchema.safeParse(payload).success).toBe(false);
  });

  it('hashes passwords with a unique salt and verifies without plaintext storage', async () => {
    const first = await hashPassword('correct-horse-battery');
    const second = await hashPassword('correct-horse-battery');

    expect(first).not.toBe(second);
    expect(first).not.toContain('correct-horse-battery');
    await expect(verifyPassword('correct-horse-battery', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', first)).resolves.toBe(false);
    await expect(verifyPassword('correct-horse-battery', 'malformed')).resolves.toBe(false);
  });

  it('stores new registrations as hashes and excludes passwords from audit payloads', async () => {
    const redis = fakeRedis();
    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });
    const email = 'hash-test@zwallet.dev';
    const password = 'correct-horse-battery';
    const deviceId = 'device-hash-test-123';

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: { 'x-nonce': 'register-hash-test' },
      payload: { email, password, deviceId },
    });

    expect(response.statusCode).toBe(200);
    const state = new GatewayStateStore(redis as any);
    const user = await state.getUser(email);
    expect(user?.passwordHash).toMatch(/^scrypt\$/);
    expect(user?.legacyPassword).toBeNull();
    expect(await redis.hget(`user:${email}`, 'password')).toBeNull();
    expect(JSON.stringify(await state.readAudit())).not.toContain(password);

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-nonce': 'login-hash-test' },
      payload: { email, password, deviceId },
    });
    expect(login.statusCode).toBe(200);
    await app.close();
  });

  it('atomically upgrades a valid legacy plaintext record on login', async () => {
    const redis = fakeRedis();
    const email = 'legacy@zwallet.dev';
    const password = 'legacy-password-123';
    const deviceId = 'legacy-device-123';
    await redis.hset(`user:${email}`, 'id', 'legacy-user-id', 'email', email, 'password', password);
    await redis.hset('devices:legacy-user-id', deviceId, '1');

    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-nonce': 'legacy-login-hash-test' },
      payload: { email, password, deviceId },
    });

    expect(response.statusCode).toBe(200);
    expect(await redis.hget(`user:${email}`, 'password')).toBeNull();
    const storedHash = await redis.hget(`user:${email}`, 'password_hash');
    expect(storedHash).toMatch(/^scrypt\$/);
    await expect(verifyPassword(password, storedHash ?? '')).resolves.toBe(true);
    await app.close();
  });

  it('does not migrate a legacy record after a failed password attempt', async () => {
    const redis = fakeRedis();
    const email = 'legacy-deny@zwallet.dev';
    const password = 'legacy-password-123';
    await redis.hset(`user:${email}`, 'id', 'legacy-deny-id', 'email', email, 'password', password);
    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-nonce': 'legacy-login-denied-test' },
      payload: { email, password: 'wrong-password-123', deviceId: 'unknown-device-123' },
    });

    expect(response.statusCode).toBe(401);
    expect(await redis.hget(`user:${email}`, 'password')).toBe(password);
    expect(await redis.hget(`user:${email}`, 'password_hash')).toBeNull();
    await app.close();
  });
});
