import type {
  SignerProviderName,
  SigningRequest,
  SigningResult,
  TransferSigner,
} from "./types.js";
import { DevSigner } from "./devSigner.js";

const signers: Partial<Record<SignerProviderName, TransferSigner>> = {
  dev: new DevSigner(),
};

export async function signTransfer(input: SigningRequest): Promise<SigningResult> {
  const signer = signers[input.key.provider];
  if (!signer) {
    throw new Error(`signer unavailable: ${input.key.provider}`);
  }
  return signer.signTransfer(input);
}

export { DevSigner };
export type {
  SignerProviderName,
  SigningKeyRef,
  SigningRequest,
  SigningResult,
  TransferSigner,
  SignTransferInput,
  SignedTransfer,
} from "./types.js";
