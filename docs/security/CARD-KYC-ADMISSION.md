# Card and KYC Admission Boundary

## Current verified limitation

The gateway currently has no authoritative, durable KYC decision store bound to the authenticated user:

- `POST /v1/compliance/kyc/start` only creates a provider application.
- `KycService.webhookUpdate()` previously defaulted a missing approval level to `full`; this parser does not verify a provider signature or persist an approval.
- `POST /v1/card/issue` accepted a client-supplied `kycLevel` and passed it to the privileged issuer adapter.
- `POST /v1/card/:id/freeze` accepted a caller-selected card ID and called the privileged issuer API without proving card ownership.

## Fail-closed containment

Until the missing trust boundaries are implemented:

- KYC application creation is bound to the authenticated JWT subject; a mismatched body `userId` is rejected before provider I/O.
- Missing provider URL/key and the known `local-dev-key` placeholder fail closed before network I/O. Provider URLs must use HTTPS, except loopback-only development/test use.
- An approved KYC event must carry an explicit level. Missing level is an invalid approval, never an implicit `full`.
- Card issuance returns HTTP 503 with `Cache-Control: no-store`; client-supplied `kycLevel` is not accepted as proof of approval.
- Card freeze returns HTTP 503 with `Cache-Control: no-store`; the gateway does not invoke the privileged issuer API without an authoritative owner binding.
- The gateway no longer injects `local-dev-key` defaults into the KYC or issuer adapters; adapters reject missing/placeholder credentials.

These controls intentionally make card issuance and freeze unavailable until the provider and persistence contracts can prove authorization. Do not add an environment flag or client parameter that bypasses these gates.

## Customer-impact gate

The card-freeze route intentionally returns HTTP 503 while owner authorization is unproven. Before any merge/deployment of this containment, an operator must establish whether real cards are active and verify a separately authenticated issuer-side freeze channel, its support owner, and an incident runbook. If no independent freeze path is verified for existing cardholders, keep this change unreleased until the issuer contract provides owner-scoped freeze. Do not leave existing customers without a working emergency freeze path.

## Re-enable acceptance criteria

1. Verify provider webhook signatures over the exact raw request body, including timestamp tolerance and key rotation.
2. Persist provider events idempotently with replay protection and monotonic state transitions.
3. Store KYC decisions under the authenticated internal user ID and provider applicant ID; never trust a client-provided KYC level.
4. Require a durable `approved` state and explicit `full` level before card issuance.
5. Persist the card-to-owner mapping atomically with issuance reconciliation, or use a provider API that enforces owner identity server-side.
6. Require owner-scoped card freeze semantics; absent and cross-user card IDs must be indistinguishable.
7. Add provider contract tests for duplicate events, stale events, conflicting events, provider timeout, ambiguous outcomes, cross-user access, and retry safety.
8. Obtain independent security review and exact-head CI, dependency, and provenance evidence before enabling provider mutations.

## Rollback

Keep the fail-closed responses in place if the KYC store, webhook verification, or issuer ownership check is unavailable. Do not restore client-controlled KYC admission or unscoped issuer freeze calls. Any re-enablement must be a separate reviewed change with sandbox evidence.

## Provider transport boundary

KYC and issuer requests carry provider credentials and must not follow redirects. Both adapters use manual redirect handling, reject every 3xx response before parsing a body, and enforce a 5-second request timeout. The issuer base URL must be HTTPS; HTTP is allowed only for loopback in development/test. Userinfo, query strings, fragments, unsupported schemes, and cross-origin endpoint construction are rejected before credential-bearing I/O.

A provider redirect is a configuration/protocol failure. Do not retry the redirected URL, copy credentials to a Location target, or disable this control to accommodate a provider. Correct the provider endpoint and verify the exact origin out of band.
