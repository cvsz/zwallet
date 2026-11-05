# Gateway Audit Log Access Boundary

## Current access contract

The gateway exposes `GET /v1/audit-logs` to authenticated users. Audit records contain a `userId` assigned by the server when the event is written. The response must include only records whose `userId` exactly matches the authenticated JWT subject (`req.user.sub`).

Records for another user, records without a user identity, and system-level records are not visible through this user endpoint. Do not add a query parameter or request-body field that lets a caller choose another user or tenant.

## Administrative access

There is currently no role-backed administrative audit endpoint in this gateway. Do not treat an authenticated user as an administrator and do not return the global audit list. If an administrative audit capability is required later, add a separate endpoint with explicit server-side RBAC, tenant scope, least-privilege policy, and independent security review.

## Regression requirements

- Seed audit events for two distinct users and a system event.
- Authenticate as one user and verify only that user's events are returned.
- Verify that another user's payload and system-level payload are absent from the response.
- Preserve authentication and anti-replay nonce requirements.
- Never log or return JWTs, service tokens, provider secrets, or raw credential material.

## Rollback

Revert the scoped route change only through a reviewed PR. Never restore global audit-log disclosure. If a future administrative endpoint is added, it must remain separately authorized and tested; it must not weaken the default user-scoped route.
