import type { ChainAdapter, ChainBalance, ChainBroadcastResult, ChainFeeEstimate } from "../types.js";
import type { WalletTransferRecord } from "../../walletEngine.js";

export class BitcoinChainAdapter implements ChainAdapter {
  readonly chain = "bitcoin" as const;

  async getBalance(address: string): Promise<ChainBalance> {
    return {
      chain: this.chain,
      address,
      asset: "BTC",
      amountAtomic: "0",
      decimals: 8
    };
  }

  async estimateFee(_transfer: WalletTransferRecord): Promise<ChainFeeEstimate> {
    return {
      chain: this.chain,
      feeAtomic: "1000"
    };
  }

  async broadcastTransfer(_transfer: WalletTransferRecord): Promise<ChainBroadcastResult> {
    throw new Error(
      "Bitcoin broadcast is disabled until a real signer, broadcaster, and finality verifier are configured"
    );
  }
}
