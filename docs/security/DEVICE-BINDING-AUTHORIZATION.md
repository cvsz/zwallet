# Gateway Device Binding Authorization

## Trust boundary

The first trusted device is bound during account registration. Binding an additional device is an authenticated account mutation and must not accept a caller-selected account ID as authority.

The gateway enforces these rules:

- A valid JWT with token type `access` is required.
- Refresh tokens are rejected by the shared authentication guard for all protected routes.
- The requested `userId` must exactly match the authenticated JWT subject.
- The Redis device write uses the authenticated subject, not the request body value.
- Successful binds emit an audit event containing a SHA-256 device identifier digest rather than the raw device identifier.
- Unauthorized and cross-user attempts do not write device state.

## Security limitations

This establishes same-account authorization for an already authenticated access-token holder. It is not a substitute for step-up MFA or WebAuthn when those controls are available. Device binding should receive a stronger step-up requirement before high-risk account recovery or financial mutations are admitted.

## Rollback

Do not restore the unauthenticated device-binding route or allow refresh tokens to authorize protected API calls. If the route must be disabled during an incident, return 503 without writing device state and use the existing account-recovery procedure.
