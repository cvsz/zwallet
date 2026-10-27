import { describe, expect, it } from 'vitest';
import { GatewayStateStore } from '../src/services/state-store.js';
import { fakeRedis } from './helpers.js';

describe('GatewayStateStore.withIdempotency', () => {
  it('allows one concurrent operation and replays its stored result', async () => {
    const state = new GatewayStateStore(fakeRedis() as any);
    let runCount = 0;
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = state.withIdempotency('issuer-auth:auth-123456', 300, async () => {
      runCount += 1;
      signalStarted();
      await gate;
      return { decision: 'approve' };
    });

    await started;
    await expect(
      state.withIdempotency('issuer-auth:auth-123456', 300, async () => {
        runCount += 1;
        return { decision: 'approve' };
      })
    ).rejects.toThrow('idempotency_conflict');

    release();
    await expect(first).resolves.toEqual({
      deduped: false,
      result: { decision: 'approve' }
    });

    await expect(
      state.withIdempotency('issuer-auth:auth-123456', 300, async () => {
        runCount += 1;
        return { decision: 'decline' };
      })
    ).resolves.toEqual({
      deduped: true,
      result: { decision: 'approve' }
    });
    expect(runCount).toBe(1);
  });

  it('fails closed after an ambiguous handler failure instead of running duplicate work', async () => {
    const state = new GatewayStateStore(fakeRedis() as any);
    let runCount = 0;

    await expect(
      state.withIdempotency('issuer-auth:auth-failed1', 300, async () => {
        runCount += 1;
        throw new Error('upstream timeout');
      })
    ).rejects.toThrow('upstream timeout');

    await expect(
      state.withIdempotency('issuer-auth:auth-failed1', 300, async () => {
        runCount += 1;
        return { decision: 'approve' };
      })
    ).rejects.toThrow('idempotency_conflict');

    expect(runCount).toBe(1);
  });
});
