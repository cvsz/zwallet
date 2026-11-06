import { MultiRpcPool, createFetchRpcClient, type RpcProvider } from '@zwallet/rpc';

const rpcProviders: RpcProvider[] = [
  { id: 'primary', chain: 'evm', url: process.env.RPC_EVM_PRIMARY ?? 'http://localhost:8545', priority: 120 },
  { id: 'secondary', chain: 'evm', url: process.env.RPC_EVM_SECONDARY ?? 'http://localhost:8546', priority: 100 },
  { id: 'solana-primary', chain: 'solana', url: process.env.RPC_SOLANA_PRIMARY ?? 'http://localhost:8899', priority: 110 },
  { id: 'btc-primary', chain: 'btc', url: process.env.RPC_BTC_PRIMARY ?? 'http://localhost:8332', priority: 110 },
];

export const rpcPool = new MultiRpcPool(rpcProviders, createFetchRpcClient);

import { randomUUID } from 'node:crypto';
import {
  createEventBusFromEnv,
  EventDeduplicator,
  Events,
  withRetry,
  type EventEnvelope,
  type WorkerResultPayload,
} from '@zwallet/events';

const eventBus = createEventBusFromEnv(process.env);
const deduplicator = new EventDeduplicator();

async function publishExecutionRejected(
  envelope: EventEnvelope,
  resultEvent: Events.TX_FAILED | Events.SWAP_FAILED,
  reason: string,
): Promise<void> {
  if (!deduplicator.shouldProcess(envelope)) return;

  const payload: WorkerResultPayload = {
    sourceEventId: envelope.eventId,
    idempotencyKey: envelope.idempotencyKey,
    status: 'failed',
    details: {
      code: 'EXECUTION_DISABLED',
      reason,
    },
  };

  await withRetry(async () => {
    await eventBus.publish(resultEvent, {
      eventId: randomUUID(),
      idempotencyKey: envelope.idempotencyKey,
      event: resultEvent,
      payload,
      timestamp: new Date().toISOString(),
    });
  });
}

async function handleTxRequested(envelope: EventEnvelope): Promise<void> {
  await publishExecutionRejected(
    envelope,
    Events.TX_FAILED,
    'Transaction execution is disabled until a verified signer, broadcaster, receipt verifier, and chain-finality reconciler are implemented.',
  );
}

async function handleSwapRequested(
  envelope: EventEnvelope<{
    fromToken: string;
    toToken: string;
    amount: string;
    slippageBps: number;
    user: string;
  }>,
): Promise<void> {
  await publishExecutionRejected(
    envelope,
    Events.SWAP_FAILED,
    'Swap execution is disabled until a verified route, signer, broadcaster, receipt verifier, and chain-finality reconciler are implemented.',
  );
}

await eventBus.connect();
await eventBus.subscribe(Events.TX_REQUESTED, handleTxRequested);
await eventBus.subscribe(Events.SWAP_REQUESTED, handleSwapRequested);
