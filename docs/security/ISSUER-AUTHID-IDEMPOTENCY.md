# Issuer Authorization Event Idempotency

## Admission contract

The issuer authentication webhook uses two distinct identifiers:

- `x-issuer-nonce` protects a signed HTTP delivery from transport replay.
- `authId` identifies the business authorization event and prevents the same authorization from invoking risk evaluation or liquidity pre-funding again when a provider retries with a fresh nonce.

The operator must provision a stable non-secret `ISSUER_ID` (1–128 ASCII letters, digits, dot, underscore, colon, or hyphen). Missing or malformed identity fails closed with HTTP 503. The gateway atomically claims a hashed `ISSUER_ID + authId` key in Redis with `SET ... NX`. The key contains no raw authorization identifier and has no automatic TTL. The payload fingerprint binds the idempotency record to the validated event. A retry with the same identifier and same payload returns the stored completed result; a different payload with the same identifier receives HTTP 409.

## Failure behavior

- A duplicate event whose result is already stored returns the original result.
- A duplicate event while the first request is processing receives HTTP 503 and `Retry-After: 5`.
- If the handler throws or the completed result cannot be persisted, the record remains in `processing` and the gateway returns a generic HTTP 503. Do not delete the record or automatically replay the event: a downstream side effect may already have completed.
- A mismatched payload fingerprint for an existing `authId` receives HTTP 409.
- If Redis cannot atomically claim or read the event record, the gateway fails closed.

## Important production limitation

This is a gateway-level deduplication guard, not proof of durable financial idempotency. The Compose profile now enables Redis AOF with `appendfsync always` and a persistent local volume for development/validation only; it also requires `POSTGRES_PASSWORD` from the environment instead of a committed default. This is not HA and is not evidence of a production restore. Redis persistence, replication/failover behavior, backup/restore, and recovery from a lost Redis dataset must be verified. The current service does not yet have a database-backed issuer-event ledger or a provider/downstream idempotency contract. Do not admit real issuer traffic until those controls and crash-recovery drills are complete.

The permanent keys need an approved retention/reconciliation policy. Do not delete a key while the issuer can replay that authorization or while its outcome is unresolved. Retention automation must be designed and reviewed separately; adding an arbitrary TTL can re-enable duplicate pre-funding.

## Operator reconciliation

1. Find the event by the SHA-256 fingerprint in structured logs and the Redis key `issuer:webhook:auth:<sha256(ISSUER_ID + NUL + authId)>`; never place raw provider secrets or full cardholder data in logs.
2. Verify the provider's authoritative authorization status and downstream liquidity ledger.
3. If the record is `processing`, reconcile the downstream side effect before any manual state change.
4. Preserve an audit trail of the operator, evidence, decision, and timestamp.
5. Do not reset the record to permit processing unless the issuer and downstream owners establish that no side effect occurred.

## Deployment configuration

- Kubernetes requires `zwallet-secrets/redis_url` for the shared Redis endpoint; it must not use the pod-local `localhost` default.
- `ISSUER_ID` is read from optional ConfigMap key `zwallet-config/issuer_id`; `ISSUER_WEBHOOK_SECRET` is read from optional Secret key `zwallet-secrets/issuer_webhook_secret`. Missing issuer configuration intentionally leaves this webhook unavailable.
- Provision values through the approved secret/configuration manager. Do not commit live values or apply the manifest to production until the target cluster's Secret/ConfigMap references and Redis durability settings have been read back.

## Required release evidence

- Disposable Redis integration tests for duplicate delivery, fresh-nonce retry, payload conflict, concurrent in-flight duplicate, cache outage, and result-persistence failure.
- Production Redis persistence/replication configuration read-back.
- Restore/failover drill proving the idempotency ledger survives the supported failure modes.
- Issuer sandbox contract proving `authId` stability and downstream idempotency behavior.
- Independent security approval, exact-head CI/security checks, signed artifact provenance, and operator approval.

No production traffic or financial execution is authorized by this change.
