import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { KycService } from '../src/services/compliance/kyc-service.js';
import { fakeRedis } from './helpers.js';

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';

describe('card and KYC admission boundaries', () => {
  const providerFetch = vi.fn();

  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'test-secret');
    vi.stubEnv('KYC_PROVIDER_BASE', '');
    vi.stubEnv('KYC_PROVIDER_KEY', '');
    vi.stubEnv('ISSUER_BASE', '');
    vi.stubEnv('ISSUER_KEY', '');
    providerFetch.mockReset();
    vi.stubGlobal('fetch', providerFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function createAuthenticatedApp(subject: string) {
    const cache = fakeRedis();
    const app = buildApp({ rateLimiter: cache as any, cache: cache as any });
    await app.ready();
    const token = await app.jwt.sign({
      sub: subject,
      deviceId: 'device-12345678',
      typ: 'access',
    });
    return {
      app,
      headers: (nonce: string) => ({
        authorization: `Bearer ${token}`,
        'x-nonce': nonce,
      }),
    };
  }

  it('binds KYC application creation to the authenticated subject', async () => {
    const { app, headers } = await createAuthenticatedApp(USER_A);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/compliance/kyc/start',
      headers: headers('kyc-cross-user'),
      payload: { userId: USER_B, country: 'TH' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'user_mismatch' });
    expect(providerFetch).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not call the KYC provider when its URL or credential is unconfigured', async () => {
    const { app, headers } = await createAuthenticatedApp(USER_A);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/compliance/kyc/start',
      headers: headers('kyc-provider-unconfigured'),
      payload: { userId: USER_A, country: 'TH' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ error: 'kyc_provider_unavailable' });
    expect(providerFetch).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not issue a card based on a client-asserted full KYC level', async () => {
    const { app, headers } = await createAuthenticatedApp(USER_A);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/card/issue',
      headers: headers('card-issue-unverified-kyc'),
      payload: {
        userId: USER_A,
        kycLevel: 'full',
        type: 'virtual',
        currency: 'USD',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ error: 'kyc_approval_unavailable' });
    expect(providerFetch).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not freeze a caller-selected card without an authoritative owner binding', async () => {
    const { app, headers } = await createAuthenticatedApp(USER_A);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/card/card-123456/freeze',
      headers: headers('card-freeze-unowned-id'),
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ error: 'card_owner_verification_unavailable' });
    expect(providerFetch).not.toHaveBeenCalled();
    await app.close();
  });

  it('requires an explicit level for an approved KYC webhook event', () => {
    const service = new KycService('https://kyc-provider.invalid', 'test-key');
    expect(() => service.webhookUpdate({
      externalUserId: USER_A,
      reviewStatus: 'approved',
    })).toThrow('KYC_APPROVAL_LEVEL_REQUIRED');

    expect(service.webhookUpdate({
      externalUserId: USER_A,
      reviewStatus: 'approved',
      level: 'basic',
    })).toEqual({
      userId: USER_A,
      status: 'approved',
      level: 'basic',
    });
  });
});
