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


## Sandbox MPC and Account-Abstraction APIs

The gateway's current MPC and account-abstraction routes are sandbox stubs backed by `SandboxMpcProvider` and `InMemoryBundlerClient`; they do not perform production MPC signing or submit a real UserOperation. The following routes must fail closed with HTTP 503 and `Cache-Control: no-store` unless both conditions hold:

- `NODE_ENV` is explicitly `development` or `test`.
- `WALLET_ENABLE_SANDBOX_MPC_AA=true` is explicitly configured.

This guard applies before audit writes or status reads to:

- `POST /v1/mpc/sign-transaction`
- `POST /v1/aa/user-operations`
- `GET /v1/aa/user-operations/:userOpHash/status`

Production, staging, unset, and unknown runtime modes remain denied even when the opt-in flag is present. Never treat the sandbox response `initiated`, synthetic `0xop_...` identifiers, or in-memory status as proof of signing, bundler submission, or on-chain confirmation.

For rollback, revert only through a reviewed PR. Do not restore sandbox MPC/AA routes in production; keep the denial in place until a real provider, durable operation state, chain receipt verification, and independent security review are implemented.
