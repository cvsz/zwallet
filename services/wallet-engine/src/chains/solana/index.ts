import type { ChainAdapter, ChainBalance, ChainBroadcastResult, ChainFeeEstimate } from "../types.js";
import type { WalletTransferRecord } from "../../walletEngine.js";

export class SolanaChainAdapter implements ChainAdapter {
  readonly chain = "solana" as const;

  async getBalance(address: string): Promise<ChainBalance> {
    return {
      chain: this.chain,
      address,
      asset: "SOL",
      amountAtomic: "0",
      decimals: 9
    };
  }

  async estimateFee(_transfer: WalletTransferRecord): Promise<ChainFeeEstimate> {
    return {
      chain: this.chain,
      feeAtomic: "5000"
    };
  }

  async broadcastTransfer(_transfer: WalletTransferRecord): Promise<ChainBroadcastResult> {
    throw new Error(
      "Solana broadcast is disabled until a real signer, broadcaster, and finality verifier are configured"
    );
  }
}
