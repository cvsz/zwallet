import {
  Worker,
} from "bullmq";

import {
  createRedisConnection,
} from "../queue/redis.js";

import {
  getTransferById,
  updateTransferStatus,
} from "../repositories/postgres/transfers.js";

import {
  allocateNonce,
} from "../repositories/postgres/nonces.js";

import {
  createPendingTransaction,
  markPendingConfirmed,
} from "../repositories/postgres/pendingTransactions.js";

import {
  getSigningKeyForAddress,
} from "../repositories/postgres/signingKeys.js";

import {
  appendSigningAudit,
} from "../repositories/postgres/signingAudit.js";

import {
  assertSigningAllowed,
} from "../policy/signingPolicy.js";

import {
  signTransfer,
} from "../signers/index.js";

import {
  broadcastTransfer,
} from "../adapters/index.js";

  new Worker(
    "transfer-execution",

    async (job) => {

      const transfer =
        await getTransferById(
          String(
            job.data.transferId
          )
        );

      if (!transfer) {
        throw new Error(
          "transfer not found"
        );
      }

      await updateTransferStatus(
        transfer.id,
        "executing"
      );

      const key =
        await getSigningKeyForAddress(
          transfer.chain,
          transfer.from
        );

      if (!key) {
        throw new Error(
          `no signing key for ${transfer.from}`
        );
      }

      assertSigningAllowed(
        transfer,
        key
      );

      const nonce =
        await allocateNonce(
          transfer.chain,
          transfer.from
        );

      await appendSigningAudit({
        transferId:
          transfer.id,

        chain:
          transfer.chain,

        address:
          transfer.from,

        provider:
          key.provider,

        keyRef:
          key.keyRef,

        action:
          "sign.requested",

        status:
          "started",
      });

      await signTransfer({
        transfer,
        key,
        nonce,
      });

      await appendSigningAudit({
        transferId:
          transfer.id,

        chain:
          transfer.chain,

        address:
          transfer.from,

        provider:
          key.provider,

        keyRef:
          key.keyRef,

        action:
          "sign.completed",

        status:
          "success",
      });

      const broadcast =
        await broadcastTransfer({
          ...transfer,
          nonce,
        });

      await createPendingTransaction({
        transferId:
          transfer.id,

        txHash:
          broadcast.txHash,

        chain:
          transfer.chain,

        nonce,
      });

      await updateTransferStatus(
        transfer.id,
        "broadcasted",
        {
          txHash:
            broadcast.txHash,
        }
      );

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            2000
          )
      );

      await markPendingConfirmed(
        transfer.id
      );

      return updateTransferStatus(
        transfer.id,
        "confirmed"
      );
    },

    {
      connection:
        createRedisConnection(),

      concurrency: 5,
    }
  );

console.log(
  "[wallet-engine] transfer worker online"
);
