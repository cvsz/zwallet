import { evmProvider } from "./rpc.js";
import type { WalletTransferRecord } from "../../walletEngine.js";

export async function estimateRealEvmFee(transfer: WalletTransferRecord) {
  const [feeData, blockNumber] = await Promise.all([
    evmProvider.getFeeData(),
    evmProvider.getBlockNumber(),
  ]);

  return {
    chain: transfer.chain,
    gasPrice: feeData.gasPrice?.toString() ?? "0",
    maxFeePerGas: feeData.maxFeePerGas?.toString() ?? null,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString() ?? null,
    observedBlock: blockNumber,
  };
}

export async function broadcastRealEvmTransfer(
  _transfer: WalletTransferRecord
): Promise<never> {
  throw new Error(
    "EVM broadcast is disabled until a real signer, signed-transaction broadcaster, and chain-finality reconciler are implemented"
  );
}
