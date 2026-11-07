/**
 * Financial transfer execution is held until a real signer, broadcaster,
 * receipt verifier, and chain-finality/reorg reconciler are implemented and
 * independently admitted.
 *
 * This module intentionally creates no BullMQ Worker and opens no Redis
 * connection. Existing queued jobs are left untouched for operator-led
 * reconciliation. Do not restore a consumer on the production queue as a
 * simulation or no-op workaround.
 */
export const transferExecutionStatus = Object.freeze({
  enabled: false,
  state: "disabled",
  reason: "execution_not_configured",
  queue: null,
} as const);
