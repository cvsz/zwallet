# MPC Signing Admission Status

**Status: DISABLED / NOT PRODUCTION-READY**

The MPC service currently has no production-grade attestation verifier, tenant-bound authorization, durable idempotent ceremony store, or independently audited threshold-signing protocol. The previous implementation used a simulated shared secret and in-memory ceremony state; it must not be treated as a production signing boundary.

Until those controls are implemented and independently verified:

- `GET /health` reports process liveness only.
- `GET /ready` returns HTTP 503.
- `POST /v1/mpc/request-sign` returns HTTP 503.
- `POST /v1/mpc/participate` returns HTTP 503.
- No signing keys, shares, payloads, or signatures are accepted, logged, persisted, or returned by the service.

## Admission requirements

1. Use a reviewed MPC protocol and cryptographic implementation with a documented threat model.
2. Verify attestation signatures against an allowlisted issuer/key set; never trust caller-supplied HMACs using a shared application secret.
3. Enforce authenticated tenant identity, participant authorization, replay protection, and idempotency.
4. Persist ceremony state durably with concurrency controls and auditable transitions.
5. Keep signing material in an approved HSM/KMS or audited MPC key-share boundary.
6. Add integration and adversarial tests, independent security review, artifact provenance, and operator-approved staging evidence.
7. Keep this service out of production deployment manifests until readiness and security admission are explicitly approved.

This change intentionally disables the simulated signing endpoints; it does not execute trades, broadcast transactions, or move customer funds.
