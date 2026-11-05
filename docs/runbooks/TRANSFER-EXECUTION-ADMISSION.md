# Wallet Transfer Execution Admission

## Current admission state

**Live transfer execution: DISABLED.**  
**Settlement/confirmation: DISABLED without independently verified chain finality.**

The wallet-engine worker is disabled for unset, production, staging, development, test, typo, and unknown values of `WALLET_TRANSFER_EXECUTION_MODE`. Only the exact value `simulation` may start the queue consumer, and that consumer is intentionally inert: it validates a transfer ID and returns `simulation_only` with `settlementEligible: false`. It does not read transfer records, allocate nonces, access signing keys, sign, broadcast, persist transaction hashes, or mutate transfer state.

All current EVM, Solana, and Bitcoin broadcast adapters fail closed. They do not generate transaction-hash-shaped placeholders. Generic repository status updates reject `confirmed`; the legacy confirmation helpers also fail closed.

## Operator mitigation

If an existing deployment is running the previous worker implementation, stop that worker process through the approved deployment control plane and keep transfer execution disabled. Do not delete or drain queued jobs as a shortcut: preserve queue contents for an audited reconciliation. This repository change does not stop an already-running process and has not been deployed.

Do not set `WALLET_TRANSFER_EXECUTION_MODE=live`. That value is deliberately treated as disabled and is not a supported admission mode.

## Re-admission requirements

Live execution must remain blocked until a separate, independently reviewed implementation demonstrates all of the following:

1. A production signer boundary (HSM/MPC or an independently controlled signing service) with key custody, rotation, authorization, and audit evidence.
2. A real chain-specific broadcaster that submits signed raw transactions and returns the provider/network transaction hash only after accepted submission.
3. Durable, tenant-bound operation identity and database-enforced idempotency before any external side effect.
4. Atomic nonce reservation and retry-safe worker semantics.
5. A chain-specific finality reconciler that verifies transaction receipt success, canonical block inclusion, confirmation/finality depth, dropped/replaced transactions, and reorg rollback.
6. Monotonic, idempotent state transitions. No timer-based or caller-supplied confirmation.
7. Integration tests against disposable local EVM/Solana/Bitcoin test networks; CI must never use production RPC endpoints or signing credentials.
8. Exact-head CI, security scanning, dependency review, SBOM, signed provenance, independent `policedbc` review, effective branch protection, and operator-approved staged rollout.

## Rollback

Revert the containment change only through a reviewed PR after the re-admission requirements are satisfied. Never restore synthetic hashes, timer-based confirmation, or a worker that can sign/broadcast without verified chain-finality evidence.

## Evidence classification

- Source-level containment: candidate change only until merged.
- CI: pending hosted exact-head execution.
- Deployment state: unknown; no deployment was performed by this change.
- Customer funds movement: not performed or authorized.
