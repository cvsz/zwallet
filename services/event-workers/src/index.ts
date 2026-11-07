/**
 * Financial event processing is intentionally disabled.
 *
 * The previous request handlers could publish TX_EXECUTED/SWAP_EXECUTED
 * success without a signer, broadcaster receipt, or chain-finality proof.
 * Keep requests unconsumed until a verified execution and settlement contract
 * is implemented. Do not publish synthetic failure/success events here:
 * downstream consumers may interpret them as settlement instructions.
 */
const reason = "execution_not_configured";

console.error(
  `[event-workers] DISABLED: ${reason}; no event bus connection, subscription, publication, or request acknowledgement is performed.`
);

throw new Error(`[event-workers] EXECUTION_DISABLED: ${reason}`);
