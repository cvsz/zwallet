# Gateway Transaction Lifecycle Simulation

## Safety boundary

`POST /v1/transactions/lifecycle` is a process-local simulation path, not a blockchain broadcast implementation. It derives a synthetic transaction identifier, mutates in-memory balances, and can report a simulated lifecycle as `confirmed`. It must not be exposed as a production transfer API.

The gateway now fails closed with HTTP 503 and `Cache-Control: no-store` unless both conditions hold:

- `NODE_ENV` is explicitly `development` or `test` (production is always denied).
- `WALLET_ENABLE_TRANSACTION_LIFECYCLE_SIMULATION=true` is explicitly configured.

The flag alone cannot enable this route in production. The default is disabled. Production Compose and PM2 configurations set `NODE_ENV=production`, so this simulation path remains unavailable there.

## Production transaction requirements

Do not remove the production guard to restore a demo flow. A real transfer implementation must be delivered separately and prove:

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

If a test-only workflow needs to be reverted, revert the source commit through a reviewed PR. Never restore this simulation endpoint in a production runtime; the production denial is a safety invariant.
