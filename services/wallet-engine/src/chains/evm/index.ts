import type { ChainAdapter, ChainBalance, ChainBroadcastResult, ChainFeeEstimate } from "../types.js";
import type { WalletTransferRecord } from "../../walletEngine.js";

export class EvmChainAdapter implements ChainAdapter {
  readonly chain = "evm" as const;

  async getBalance(address: string): Promise<ChainBalance> {
    return {
      chain: this.chain,
      address,
      asset: "ETH",
      amountAtomic: "0",
      decimals: 18
    };
  }

  async estimateFee(_transfer: WalletTransferRecord): Promise<ChainFeeEstimate> {
    return {
      chain: this.chain,
      feeAtomic: "21000000000000",
      gasLimit: "21000",
      gasPrice: "1000000000"
    };
  }

  async broadcastTransfer(_transfer: WalletTransferRecord): Promise<ChainBroadcastResult> {
    throw new Error(
      "EVM broadcast is disabled until a real signer, broadcaster, and finality verifier are configured"
    );
  }
}
