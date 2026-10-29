import { describe, expect, it } from 'vitest';
import { GatewayStateStore } from '../src/services/state-store.js';
import { fakeRedis } from './helpers.js';

describe('GatewayStateStore.withIdempotency', () => {
  it('allows one in-flight owner and replays the completed result', async () => {
    const redis = fakeRedis();
    const state = new GatewayStateStore(redis as any);
    let runCount = 0;
    let signalStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const first = state.withIdempotency('register:key-001', 300, async () => {
      runCount += 1;
      signalStarted();
      await gate;
      return { conflict: false, userId: 'stable-user-id' };
    }, 'fp-1');

    await started;
    await expect(
      state.withIdempotency('register:key-001', 300, async () => {
        runCount += 1;
        return { conflict: false, userId: 'other-user-id' };
      }, 'fp-1')
    ).rejects.toThrow('idempotency_conflict');

    release();
    await expect(first).resolves.toEqual({
      deduped: false,
      result: { conflict: false, userId: 'stable-user-id' },
    });
    await expect(
      state.withIdempotency('register:key-001', 300, async () => {
        runCount += 1;
        return { conflict: false, userId: 'other-user-id' };
      }, 'fp-1')
    ).resolves.toEqual({
      deduped: true,
      result: { conflict: false, userId: 'stable-user-id' },
    });
    expect(runCount).toBe(1);
  });


  it('rejects reuse of a completed key with a different request fingerprint', async () => {
    const state = new GatewayStateStore(fakeRedis() as any);
    await state.withIdempotency('register:key-002', 300, async () => ({ userId: 'first-user' }), 'fp-first');

    await expect(
      state.withIdempotency('register:key-002', 300, async () => ({ userId: 'second-user' }), 'fp-second')
    ).rejects.toThrow('idempotency_payload_conflict');
  });

  it('fails closed while a prior attempt has no completed result', async () => {
    const state = new GatewayStateStore(fakeRedis() as any);
    await expect(
      state.withIdempotency('register:failed', 300, async () => {
        throw new Error('synthetic failure');
      })
    ).rejects.toThrow('synthetic failure');
    await expect(
      state.withIdempotency('register:failed', 300, async () => ({ ok: true }))
    ).rejects.toThrow('idempotency_conflict');
  });
});
