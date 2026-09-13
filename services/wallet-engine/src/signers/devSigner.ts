import { createHash } from "node:crypto";
import type { SigningRequest, SigningResult, TransferSigner } from "./types.js";

export class DevSigner implements TransferSigner {
  provider = "dev" as const;

  async signTransfer(input: SigningRequest): Promise<SigningResult> {
    const rawTransaction = createHash("sha256")
      .update(JSON.stringify({
        transferId: input.transfer.id,
        keyRef: input.key.keyRef,
        nonce: input.nonce,
        amountAtomic: input.transfer.amountAtomic,
      }))
      .digest("hex");

    return {
      signature: createHash("sha256").update(`signature:${rawTransaction}`).digest("hex"),
      rawTransaction,
      provider: "dev",
      simulated: true,
    };
  }
}
