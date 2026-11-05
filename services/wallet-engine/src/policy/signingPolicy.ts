import type {
  WalletTransferRecord,
} from "../walletEngine.js";

import type {
  SigningKeyRef,
} from "../signers/types.js";

export function assertSigningAllowed(
  transfer: WalletTransferRecord,
  key: SigningKeyRef
) {

  if (
    key.status !== "active"
  ) {
    throw new Error(
      "signing key disabled"
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    key.provider === "dev"
  ) {
    throw new Error(
      "development signer is forbidden in production"
    );
  }

  if (
    transfer.chain !== key.chain
  ) {
    throw new Error(
      "signing key chain mismatch"
    );
  }

  if (
    transfer.from.toLowerCase() !==
    key.address.toLowerCase()
  ) {
    throw new Error(
      "signing key address mismatch"
    );
  }

  if (
    BigInt(
      transfer.amountAtomic
    ) <= 0n
  ) {
    throw new Error(
      "invalid transfer amount"
    );
  }
}
