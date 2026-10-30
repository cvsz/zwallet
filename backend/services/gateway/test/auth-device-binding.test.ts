import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakeRedis, registerAndLogin, resetStore } from './helpers.js';

const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';

describe('authenticated device binding', () => {
  beforeEach(() => {
    resetStore();
    vi.stubEnv('JWT_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function createTestApp() {
    const cache = fakeRedis();
    const app = buildApp({ rateLimiter: cache as any, cache: cache as any });
    await app.ready();
    return { app, cache };
  }

  it('rejects unauthenticated device binding before writing device state', async () => {
    const { app, cache } = await createTestApp();
    const hset = vi.spyOn(cache, 'hset');

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/bind',
      payload: {
        userId: OTHER_USER_ID,
        deviceId: 'attacker-device-123',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(hset).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects cross-user device binding before writing device state', async () => {
    const { app, cache } = await createTestApp();
    const accessToken = await registerAndLogin(app);
    const hset = vi.spyOn(cache, 'hset');
    hset.mockClear();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/bind',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        userId: OTHER_USER_ID,
        deviceId: 'attacker-device-123',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'user_mismatch' });
    expect(hset).not.toHaveBeenCalled();
    await app.close();
  });

  it('allows an access-token holder to bind only their own additional device', async () => {
    const { app } = await createTestApp();
    const accessToken = await registerAndLogin(app);
    const claims = await app.jwt.verify(accessToken) as { sub: string };

    const bind = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/bind',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        userId: claims.sub,
        deviceId: 'new-device-12345678',
      },
    });

    expect(bind.statusCode).toBe(200);
    expect(bind.json()).toEqual({ bound: true });
    expect(bind.headers['cache-control']).toBe('no-store');

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'test@zwallet.dev',
        password: 'password1',
        deviceId: 'new-device-12345678',
      },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().accessToken).toBeTruthy();
    await app.close();
  });

  it('rejects refresh tokens on protected device-binding routes', async () => {
    const { app, cache } = await createTestApp();
    const hset = vi.spyOn(cache, 'hset');
    const refreshToken = await app.jwt.sign(
      {
        sub: OTHER_USER_ID,
        deviceId: 'device-12345678',
        typ: 'refresh',
      },
      { expiresIn: '7d' },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/device/bind',
      headers: { authorization: `Bearer ${refreshToken}` },
      payload: {
        userId: OTHER_USER_ID,
        deviceId: 'attacker-device-123',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(hset).not.toHaveBeenCalled();
    await app.close();
  });
});
