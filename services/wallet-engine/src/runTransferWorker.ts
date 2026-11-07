import { transferExecutionStatus } from "./workers/transferWorker.js";

console.error(
  `[wallet-engine] transfer worker ${transferExecutionStatus.state}: ${transferExecutionStatus.reason}; no Redis connection or queue consumer was started.`
);
