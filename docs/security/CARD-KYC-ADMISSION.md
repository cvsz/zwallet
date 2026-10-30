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
- An approved KYC event must carry an explicit level. Missing level is an invalid approval, never an implicit `full`.
- Card issuance returns HTTP 503 with `Cache-Control: no-store`; client-supplied `kycLevel` is not accepted as proof of approval.
- Card freeze returns HTTP 503 with `Cache-Control: no-store`; the gateway does not invoke the privileged issuer API without an authoritative owner binding.

These controls intentionally make card issuance and freeze unavailable until the provider and persistence contracts can prove authorization. Do not add an environment flag or client parameter that bypasses these gates.

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
