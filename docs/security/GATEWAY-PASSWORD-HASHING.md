# Gateway Password Storage Hardening

## Scope

The gateway must never write new plaintext passwords to Redis or include passwords in audit events.

- New registrations store a salted scrypt hash in `password_hash`.
- Password inputs are limited to 8–1024 characters before scrypt work begins to bound CPU/memory use from oversized requests.
- Authentication verifies hashes using constant-time comparison.
- Existing legacy records are upgraded only after a successful password check. A Redis Lua compare-and-set writes the hash and removes the legacy `password` field atomically.
- Credential fields are read together with `HMGET`; if a record already has both a hash and a legacy plaintext field, the plaintext field is removed atomically.
- Failed login attempts do not migrate or modify legacy credentials.
- Registration audit events contain only the email and device identifier; they never include the submitted password.
- The root pnpm workspace includes `backend/services/*` so gateway tests and the TypeScript build are part of CI.
- CI starts a disposable Redis 7.4 service and runs `password-redis.integration.test.ts` against real Redis Lua execution. The test uses unique keys and deletes them after execution.

## Compatibility and rollout

This is a backward-compatible, lazy migration for existing Redis records. Users with legacy records can continue to sign in; the first successful sign-in upgrades that record. Passwords longer than 1024 characters are rejected by both registration and login. Legacy records for inactive users may still contain plaintext until they sign in or an operator performs an approved migration.

Before production admission:

1. Run the exact-head gateway tests, TypeScript build, dependency review, CodeQL and secret scanning.
2. Verify a new registration stores only `password_hash` and that its audit record contains no password.
3. Verify correct legacy credentials upgrade atomically, incorrect credentials do not change the record, and concurrent legacy sign-ins converge on one valid hash.
4. Inventory remaining legacy records without exporting or logging their password values; define an operator-approved migration or password-reset plan for dormant accounts.
5. Verify backups and recovery procedures do not expose or reintroduce plaintext credentials.
6. Confirm `pnpm-lock.yaml` contains the gateway importer and all resolved dependencies before release; the current root CI uses a non-frozen install and must not be treated as proof of a reproducible dependency graph until the lockfile is committed and frozen-lockfile validation is enabled.

## Validation commands

With a disposable Redis instance available at `REDIS_URL`:

```sh
pnpm install --frozen-lockfile=false
pnpm --filter @zwallet/gateway test
pnpm --filter @zwallet/gateway build
```

The integration test skips when `REDIS_URL` is absent. CI must provide the disposable Redis service so the real-Lua tests are not skipped.

## Rollback

Before merge, close this draft PR to leave `main` unchanged. After deployment, do not roll back to code that writes plaintext passwords or password-bearing audit events. If an incompatibility appears, disable new registrations through the approved operational control and ship a corrective forward fix. Preserve existing hashes and the atomic legacy-upgrade behavior.

## Current verification status

The gateway regression tests and real-Redis integration tests are committed on the candidate branch but have not been executed in this connector-only run. Exact-head CI must demonstrate test and build success, and independent review must close the blockers before production admission.
