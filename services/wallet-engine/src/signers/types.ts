import type { WalletTransferRecord } from "../walletEngine.js";

export type SignerProviderName =
  | "dev"
  | "vault"
  | "aws-kms"
  | "gcp-kms"
  | "mpc";

export interface SigningKeyRef {
  id: string;
  chain: string;
  address: string;
  provider: SignerProviderName;
  keyRef: string;
  status: "active" | "disabled";
}

export interface SigningRequest {
  transfer: WalletTransferRecord;
  key: SigningKeyRef;
  nonce: number;
}

export interface SigningResult {
  signature: string;
  rawTransaction: string;
  provider: SignerProviderName;
  simulated: boolean;
}

export interface TransferSigner {
  provider: SignerProviderName;
  signTransfer(input: SigningRequest): Promise<SigningResult>;
}

export type SignTransferInput = SigningRequest;
export type SignedTransfer = SigningResult;
