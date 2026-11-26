# Swap Quote and Execution Hold

## Admission

The customer-facing swap quote and execution routes are intentionally fail-closed until independently verified market data, signing, broadcast, settlement, and chain-finality evidence are available.

The hold returns HTTP 503 with `Cache-Control: no-store` from:
- FastAPI `POST /quote`
- FastAPI `POST /execute`
- Gateway `POST /v1/flow/wallet-sign-swap`
- Swap service `POST /v1/swaps/quote`
- Swap service `POST /v1/swaps/execute`

The gateway route retains authentication before returning the hold. The held routes do not call wallet, policy, swap, indexer, or portfolio downstream services and do not create synthetic transaction hashes or success records.

## Verification required before re-admission

1. Use authenticated, tenant-bound requests and durable idempotency keys.
2. Integrate authenticated market-data/aggregator responses with source, timestamp, chain, token, and expiry validation.
3. Use an approved signer boundary; never expose signing keys to the gateway.
4. Verify broadcast responses against the transaction bytes and canonical chain hash.
5. Persist pending state before broadcast and reconcile receipts, confirmations, reorgs, and terminal transitions from canonical chain evidence.
6. Add concurrent retry, timeout-after-broadcast, RPC disagreement, tenant-isolation, and zero-side-effect tests.
7. Pass exact-head hosted CI, security, dependency, SBOM, and independent review gates.
8. Obtain explicit operator approval before any production re-admission.

## Operational boundary

This source change does not stop already-running containers or workers and does not inspect, drain, purge, delete, reset, or replay any queue, topic, offset, or DLQ. Keep the separate worker/event-consumer containment PR and runtime fencing evidence as independent gates.

No transaction signing, RPC broadcast, payment, trade, customer-fund movement, or production deployment is performed by this change.

## Rollback

Do not roll back to synthetic quote or execution handlers. If this patch causes an unrelated regression, restore the affected non-financial route behavior only through a reviewed patch while keeping quote and execution held. Re-admission requires the verification criteria above.
