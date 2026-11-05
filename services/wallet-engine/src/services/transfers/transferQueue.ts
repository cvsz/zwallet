import { randomUUID } from "node:crypto";
import type { WalletTransferRecord } from "../../walletEngine.js";

export type TransferExecutionStatus =
  | "previewed"
  | "queued"
  | "executing"
  | "confirmed"
  | "failed"
  | "cancelled";

export interface TransferQueueEvent {
  id: string;
  transferId: string;
  status: TransferExecutionStatus;
  message: string;
  occurredAt: string;
}

const queueEvents = new Map<string, TransferQueueEvent[]>();

export function appendTransferQueueEvent(
  transferId: string,
  status: TransferExecutionStatus,
  message: string
): TransferQueueEvent {
  const event: TransferQueueEvent = {
    id: randomUUID(),
    transferId,
    status,
    message,
    occurredAt: new Date().toISOString(),
  };

  const events = queueEvents.get(transferId) ?? [];
  events.unshift(event);
  queueEvents.set(transferId, events);

  return event;
}

export function listTransferQueueEvents(transferId: string): TransferQueueEvent[] {
  return queueEvents.get(transferId) ?? [];
}

export function markTransferQueued<T extends WalletTransferRecord>(transfer: T): T {
  appendTransferQueueEvent(transfer.id, "queued", "Transfer queued for execution");
  return {
    ...transfer,
    status: "queued",
    updatedAt: new Date().toISOString(),
  };
}

export function markTransferExecuting<T extends WalletTransferRecord>(transfer: T): T {
  appendTransferQueueEvent(transfer.id, "executing", "Transfer execution started");
  return {
    ...transfer,
    status: "executing",
    updatedAt: new Date().toISOString(),
  };
}

export function markTransferConfirmed<T extends WalletTransferRecord>(
  _transfer: T,
  _txHash?: string
): T & { txHash: string } {
  throw new Error(
    "Transfer confirmation requires independently verified chain finality; caller-supplied or simulated hashes are not accepted"
  );
}

export function markTransferFailed<T extends WalletTransferRecord>(
  transfer: T,
  reason: string
): T & { failureReason: string } {
  appendTransferQueueEvent(transfer.id, "failed", reason);
  return {
    ...transfer,
    status: "failed",
    failureReason: reason,
    updatedAt: new Date().toISOString(),
  };
}
