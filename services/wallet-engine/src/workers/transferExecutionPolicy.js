/** @typedef {"disabled" | "simulation"} TransferExecutionMode */

/**
 * Only the exact "simulation" value may start the inert queue consumer.
 * Every other value, including "live", production, unset, and typos, disables it.
 * @param {string | undefined} value
 * @returns {TransferExecutionMode}
 */
export function resolveTransferExecutionMode(value) {
  return value === "simulation" ? "simulation" : "disabled";
}
