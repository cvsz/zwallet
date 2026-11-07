# Financial Execution Hold

**Admission: NO-GO — live transfer and swap execution are disabled.**

## Source-level containment

The current candidate intentionally:
- does not instantiate a BullMQ consumer for `transfer-execution`;
- does not connect the wallet transfer worker to Redis;
- makes the transfer worker runner report `disabled / execution_not_configured`;
- fails the event-worker entrypoint before any event-bus connection, subscription, publication, or request acknowledgement;
- removes `event-workers` from the production Docker Compose service set;
- removes the corresponding Prometheus scrape target;
- runs a standalone Node regression contract before the repository's broader CI validation.

No synthetic `TX_EXECUTED` or `SWAP_EXECUTED` success may be emitted. Do not publish substitute failure events until downstream consumers and settlement/refund semantics have been audited; an unconsumed request is safer than an event that could trigger an unintended financial side effect.

## Existing runtime containment is still an operator gate

Merging this source change does not stop an already-running container, process, Kubernetes workload, external worker, or older image. An authorized operator must:

1. Inventory all deployed wallet transfer and event-worker processes by workload, namespace, image digest, command, replica count, and deployment revision.
2. Stop/fence existing consumers through the approved deployment control plane.
3. Preserve Redis/BullMQ jobs, Kafka topics, consumer offsets, retention, and dead-letter queues. Do not drain, purge, delete, reset offsets, or replay requests as a shortcut.
4. Capture before/after worker and queue/consumer evidence, timestamps, and the exact deployed image digests.
5. Reconcile pending transfers only from canonical chain transaction receipts and chain-specific finality/reorg evidence. Do not infer settlement from a local hash, HTTP response, or event.

This repository change does not claim that any running production worker has been stopped or that any production queue has been inspected.

## Re-admission criteria

Do not re-enable financial workers until all of the following are implemented and independently verified:

- production-grade signer custody and authorization;
- chain-specific transaction construction and actual broadcast;
- canonical receipt verification, confirmation depth/finality, and reorganization handling;
- durable tenant-bound idempotency and transactional outbox/inbox semantics;
- replay, duplicate, concurrency, restart, timeout, and unknown-outcome reconciliation tests;
- no synthetic success event or fabricated transaction hash;
- full workspace typecheck/lint/build and exact-head hosted security checks;
- signed commit/artifact provenance and fresh independent review;
- operator-approved staging rehearsal, rollback and recovery evidence.

Live payments, transfers, swaps, trades, and customer-money movement remain disabled. This runbook is not authorization to perform those operations.
