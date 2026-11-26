import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { store } from '../src/utils/store.js';
import { fakeRedis, resetStore } from './helpers.js';

describe('financial swap execution hold', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('JWT_SECRET', 'test-secret');
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rejects the authenticated gateway flow before any downstream side effect', async () => {
    const downstreamFetch = vi.fn(async () => {
      throw new Error('downstream request must not occur while swap execution is held');
    });
    vi.stubGlobal('fetch', downstreamFetch);

    const redis = fakeRedis();
    const app = buildApp({ rateLimiter: redis as any, cache: redis as any });
    await app.ready();

    try {
      const token = await app.jwt.sign({ sub: 'user-1', deviceId: 'device-1', typ: 'access' });
      const response = await app.inject({
        method: 'POST',
        url: '/v1/flow/wallet-sign-swap',
        headers: { authorization: `Bearer ${token}`, 'x-nonce': 'swap-execution-held' },
        payload: { chain: 'ethereum', fromToken: 'USDC', toToken: 'ETH', amount: '100', slippageBps: 50 },
      });

      expect(response.statusCode).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ error: 'swap_execution_disabled' });
      expect(downstreamFetch).not.toHaveBeenCalled();
      expect(store.wallets).toHaveLength(0);
      expect(store.txIndex).toHaveLength(0);
      expect(store.swaps).toHaveLength(0);
      expect(store.balances.size).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('keeps direct swap-service quote and execute routes fail-closed', () => {
    const source = readFileSync(new URL('../../swap-service/src/index.ts', import.meta.url), 'utf8');
    const quoteStart = source.indexOf("app.post('/v1/swaps/quote'");
    const executeStart = source.indexOf("app.post('/v1/swaps/execute'");
    const listenStart = source.indexOf('\n\nawait app.listen', executeStart);

    expect(quoteStart).toBeGreaterThanOrEqual(0);
    expect(executeStart).toBeGreaterThan(quoteStart);
    expect(listenStart).toBeGreaterThan(executeStart);

    const quoteRoute = source.slice(quoteStart, executeStart);
    const executeRoute = source.slice(executeStart, listenStart);

    expect(quoteRoute).toContain('reply.code(503)');
    expect(quoteRoute).toContain('swap_quotes_unavailable');
    expect(quoteRoute).not.toContain('routingEngine.buildRoutes');

    expect(executeRoute).toContain('reply.code(503)');
    expect(executeRoute).toContain('swap_execution_disabled');
    expect(executeRoute).not.toContain('executionPipeline.executeWithFallback');
  });
});
