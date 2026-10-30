import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeRedis, resetStore } from './helpers.js';

import { buildApp } from '../src/app.js';
import { store } from '../src/utils/store.js';

describe('e2e: create wallet, send transaction, swap token', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WALLET_ENABLE_TRANSACTION_LIFECYCLE_SIMULATION', 'true');
    resetStore();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/v1/ai/inference/swap-recommendation')) {
        return { ok: true, json: async () => ({ urgency: 'high', risk_score: 0.05 }) } as Response;
      }
      return { ok: true, json: async () => ({ quote: { routeId: 'route-1' }, tx: { hash: '0xtxhash' }, address: '0xwallet1', allowed: true, assets: [], valid: true, queued: true }) } as Response;
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); global.fetch = originalFetch; });

  it('blocks synthetic transaction confirmation in production even when the simulation flag is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('WALLET_ENABLE_TRANSACTION_LIFECYCLE_SIMULATION', 'true');
    process.env.JWT_SECRET = 'test-secret';
    const app = buildApp({ rateLimiter: fakeRedis() as any, cache: fakeRedis() as any });
    await app.ready();
    const token = await app.jwt.sign({ sub: 'user-1', deviceId: 'device-1', typ: 'access' });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions/lifecycle',
      headers: { authorization: `Bearer ${token}`, 'x-nonce': 'production-simulation-block' },
      payload: {
        chain: 'evm',
        from: '0xsender',
        to: '0xreceiver',
        value: '10',
        signatureHex: 'abcdef123456',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ error: 'transaction_lifecycle_simulation_disabled' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.balances.size).toBe(0);
    expect(store.txIndex).toHaveLength(0);
    await app.close();
  });

  it('requires explicit opt-in for the simulated lifecycle outside production', async () => {
    vi.stubEnv('WALLET_ENABLE_TRANSACTION_LIFECYCLE_SIMULATION', 'false');
    process.env.JWT_SECRET = 'test-secret';
    const app = buildApp({ rateLimiter: fakeRedis() as any, cache: fakeRedis() as any });
    await app.ready();
    const token = await app.jwt.sign({ sub: 'user-1', deviceId: 'device-1', typ: 'access' });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions/lifecycle',
      headers: { authorization: `Bearer ${token}`, 'x-nonce': 'simulation-opt-in-required' },
      payload: {
        chain: 'evm',
        from: '0xsender',
        to: '0xreceiver',
        value: '10',
        signatureHex: 'abcdef123456',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'transaction_lifecycle_simulation_disabled' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(store.balances.size).toBe(0);
    await app.close();
  });

  it('runs wallet -> transaction -> swap flow', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const app = buildApp({ rateLimiter: fakeRedis() as any, cache: fakeRedis() as any });
    await app.ready();
    const token = await app.jwt.sign({ sub: 'user-1', deviceId: 'device-1', typ: 'access' });
    const wallet = await app.inject({ method: 'POST', url: '/v1/wallet-metadata', headers: { authorization: `Bearer ${token}`, 'x-nonce': 'n1' }, payload: { walletLabel: 'e2e', network: 'evm', address: '0xsender' } });
    expect(wallet.statusCode, wallet.body).toBe(200);
    const tx = await app.inject({ method: 'POST', url: '/v1/transactions/lifecycle', headers: { authorization: `Bearer ${token}`, 'x-nonce': 'n2' }, payload: { chain: 'evm', from: '0xsender', to: '0xreceiver', value: '10', signatureHex: 'abcdef123456' } });
    expect(tx.statusCode).toBe(200);
    const swap = await app.inject({ method: 'POST', url: '/v1/flow/wallet-sign-swap', headers: { authorization: `Bearer ${token}`, 'x-nonce': 'n3' }, payload: { chain: 'ethereum', fromToken: 'USDC', toToken: 'ETH', amount: '100', slippageBps: 50 } });
    expect(swap.statusCode).toBe(200);

    // Phase 6: Test new Intelligent Orchestration endpoint
    const orchestrate = await app.inject({ 
      method: 'POST', 
      url: '/v1/swaps/orchestrate', 
      headers: { authorization: `Bearer ${token}`, 'x-nonce': 'n4' }, 
      payload: { 
        chain: 'evm', 
        fromToken: 'ETH', 
        toToken: 'DAI', 
        amount: 1.5, 
        slippageBps: 100, 
        urgency: 'high' 
      } 
    });
    expect(orchestrate.statusCode).toBe(200);
    expect(orchestrate.json().intelligence).toBeDefined();
    expect(orchestrate.json().intelligence.urgency).toBe('high');
    
    await app.close();
  });
});
