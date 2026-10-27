# Gateway Password Storage Hardening

## Scope

The gateway must never write new plaintext passwords to Redis or include passwords in audit events.

- New registrations store a salted scrypt hash in `password_hash`.
- Authentication verifies hashes using constant-time comparison.
- Existing legacy records are upgraded only after a successful password check. A Redis Lua compare-and-set writes the hash and removes the legacy `password` field atomically.
- Failed login attempts do not migrate or modify legacy credentials.
- Registration audit events contain only the email and device identifier; they never include the submitted password.

## Compatibility and rollout

This is a backward-compatible, lazy migration for existing Redis records. Users with legacy records can continue to sign in; the first successful sign-in upgrades that record. Legacy records for inactive users may still contain plaintext until they sign in or an operator performs an approved migration.

Before production admission:

1. Run the exact-head gateway tests, TypeScript build, dependency review, CodeQL and secret scanning.
2. Verify a new registration stores only `password_hash` and that its audit record contains no password.
3. Verify correct legacy credentials upgrade atomically, incorrect credentials do not change the record, and concurrent legacy sign-ins converge on one valid hash.
4. Inventory remaining legacy records without exporting or logging their password values; define an operator-approved migration or password-reset plan for dormant accounts.
5. Verify backups and recovery procedures do not expose or reintroduce plaintext credentials.

## Rollback

Before merge, close this draft PR to leave `main` unchanged. After deployment, do not roll back to code that writes plaintext passwords or password-bearing audit events. If an incompatibility appears, disable new registrations through the approved operational control and ship a corrective forward fix. Preserve existing hashes and the atomic legacy-upgrade behavior.

## Current verification status

The regression tests are committed in `backend/services/gateway/test/password-security.test.ts`. They have not been executed in this connector-only run. Do not treat the source change as production-ready until executable exact-head CI and independent review pass.
