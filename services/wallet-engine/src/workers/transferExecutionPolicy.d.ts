export type TransferExecutionMode = "disabled" | "simulation";

export declare function resolveTransferExecutionMode(
  value: string | undefined
): TransferExecutionMode;
