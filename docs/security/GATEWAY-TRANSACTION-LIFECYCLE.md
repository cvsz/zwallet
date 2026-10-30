# Gateway Transaction Lifecycle Simulation

## Safety boundary

`POST /v1/transactions/lifecycle` and `GET /v1/transactions/lifecycle/:txId` are process-local simulation paths, not a blockchain broadcast implementation. It derives a synthetic transaction identifier, mutates in-memory balances, and can report a simulated lifecycle as `confirmed`. It must not be exposed as a production transfer API.

Both lifecycle routes now fail closed with HTTP 503 and `Cache-Control: no-store` unless both conditions hold:

- `NODE_ENV` is explicitly `development` or `test` (production is always denied).
- `WALLET_ENABLE_TRANSACTION_LIFECYCLE_SIMULATION=true` is explicitly configured.

The flag alone cannot enable either route in production or staging/unknown runtimes. The default is disabled. Production Compose and PM2 configurations set `NODE_ENV=production`, so this simulation path remains unavailable there. The GET route also returns HTTP 404 unless the authenticated subject owns the stored lifecycle record. Existing Redis records are not deleted by this guard; their existing TTL expires naturally. Never point a development/test runtime at production Redis.

## Production transaction requirements

Do not remove either lifecycle guard or the owner check to restore a demo flow. A real transfer implementation must be delivered separately and prove:

- chain-specific transaction construction and simulation;
- trusted RPC submission and chain receipt/finality verification;
- signer/MPC boundary and least-privilege authorization;
- durable, tenant-scoped idempotency and ledger updates;
- replay/concurrency protection and reconciliation;
- audit evidence that distinguishes submitted, pending, confirmed, failed, and reverted states.

A synthetic hash, process-local balance, indexer request, or HTTP 200 response is not proof of an on-chain transfer.

## Development and test use

For isolated development/test only, set:

```bash
NODE_ENV=test
WALLET_ENABLE_TRANSACTION_LIFECYCLE_SIMULATION=true
```

Do not set the flag in production. Remove it after the test session. No production payment, transfer, or swap should be used to validate this simulation path.

## Rollback

If a test-only workflow needs to be reverted, revert the source commit through a reviewed PR. Never restore these simulation routes in a production runtime; the production denial and owner check are safety invariants.
