import { createHash, randomUUID } from 'node:crypto';
import { assertTransferRequest } from '@zwallet/shared-types/wallet';
import type {
  SupportedChain,
  TransferRequest,
  WalletEventType
} from '@zwallet/shared-types/contracts';

export type WalletTransferStatus =
  | 'previewed'
  | 'queued'
  | 'executing'
  | 'confirmed'
  | 'signed'
  | 'broadcasted'
  | 'failed'
  | 'cancelled';

export interface WalletAccount {
  id: string;
  userId: string;
  chain: SupportedChain;
  address: string;
  label: string;
  status: 'active' | 'frozen';
  createdAt: string;
  updatedAt: string;
}

export interface WalletBalance {
  accountId: string;
  chain: SupportedChain;
  asset: string;
  amountAtomic: string;
  decimals: number;
  updatedAt: string;
}

export interface WalletTransferRecord {
  id: string;
  digest: string;
  chain: SupportedChain;
  from: string;
  to: string;
  amountAtomic: string;
  nonce: number;
  status: WalletTransferStatus;
  createdAt: string;
  updatedAt: string;
  txHash?: string;
  failureReason?: string;
}

export interface WalletEventRecord {
  id: string;
  type: WalletEventType;
  chain: SupportedChain;
  occurredAt: string;
  userId: string;
  payload: Record<string, unknown>;
}

export interface WalletOverview {
  accounts: WalletAccount[];
  balances: WalletBalance[];
  transfers: WalletTransferRecord[];
  events: WalletEventRecord[];
}

export interface TransferPreview {
  id: string;
  digest: string;
  canonical: string;
}

export function buildTransferDigest(request: unknown): TransferPreview {
  assertTransferRequest(request);
  const payload = request as TransferRequest;
  const canonical = JSON.stringify({
    chain: payload.chain,
    from: payload.from.toLowerCase(),
    to: payload.to.toLowerCase(),
    amountAtomic: String(payload.amountAtomic),
    nonce: Number(payload.nonce ?? 0),
    createdAt: payload.createdAt ?? new Date().toISOString()
  });
  return {
    id: randomUUID(),
    digest: createHash('sha256').update(canonical).digest('hex'),
    canonical
  };
}
