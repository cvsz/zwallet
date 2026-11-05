import { Worker } from "bullmq";
import { createRedisConnection } from "../queue/redis.js";
import { resolveTransferExecutionMode } from "./transferExecutionPolicy.js";

export const transferExecutionMode = resolveTransferExecutionMode(
  process.env.WALLET_TRANSFER_EXECUTION_MODE
);

export const transferWorker =
  transferExecutionMode === "simulation"
    ? new Worker(
        "transfer-execution",
        async (job) => {
          const transferId = job.data?.transferId;

          if (typeof transferId !== "string" || transferId.length === 0) {
            throw new Error("transferId is required");
          }

          // Simulation mode acknowledges queue work only. It must never sign,
          // broadcast, persist a transaction hash, or mark a transfer settled.
          return {
            transferId,
            status: "simulation_only",
            settlementEligible: false,
          };
        },
        {
          connection: createRedisConnection(),
          concurrency: 1,
        }
      )
    : undefined;

if (!transferWorker) {
  console.warn(
    "[wallet-engine] transfer execution disabled; only explicit simulation mode may start the inert worker"
  );
}
