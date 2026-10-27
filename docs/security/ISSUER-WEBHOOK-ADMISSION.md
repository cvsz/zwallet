# Issuer Authentication Webhook Admission

## Security contract

The gateway must not authenticate issuer callbacks with a built-in or development fallback. `ISSUER_WEBHOOK_SECRET` must be provisioned through the approved secret manager before issuer authentication callbacks are enabled.

Admission policy: the configured secret must be at least 32 UTF-8 bytes, contain at least 8 distinct characters, have no leading/trailing whitespace, and contain no ASCII control characters. Use a cryptographically random issuer-compatible value. If an existing provider secret does not meet this policy, keep callback admission closed and coordinate rotation with the issuer owner; do not silently trim or transform the secret.

- Missing, empty, or whitespace-only secret: return HTTP 503 with a generic `webhook_unavailable` response before invoking the business handler.
- Missing signature or nonce: return HTTP 401.
- Invalid HMAC: return HTTP 401.
- Reused nonce: return HTTP 409.
- Valid signature and fresh nonce: continue through schema validation and the issuer handler.

Use a cryptographically generated, issuer-compatible secret. Never store it in source control, image layers, test fixtures, issue comments, or CI logs. The request-signature algorithm and payload canonicalization must match the issuer's contract.

## Rollout and verification

1. Provision the correct `ISSUER_WEBHOOK_SECRET` in the production secret manager; do not copy it into GitHub source.
2. Confirm the deployed environment receives the value without printing it.
3. In a non-production issuer sandbox, verify missing/blank secret returns 503, invalid signature returns 401, replay returns 409, and valid callbacks pass.
4. Verify callback retries are safe and that the handler's downstream mutation remains idempotent.
5. Monitor generic 503/401/409 counters and provider delivery retries before production promotion.

## Rollback

Do not restore `local-webhook-secret` or any other source-code fallback. If the callback returns 503, correct secret-manager provisioning or disable issuer callback admission through the approved operational control. Keep this change Draft until exact-head CI/security checks, independent review, signed provenance, and sandbox evidence pass.
