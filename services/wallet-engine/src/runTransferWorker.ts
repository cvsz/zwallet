import {
  transferExecutionMode,
  transferWorker,
} from "./workers/transferWorker.js";

if (transferWorker) {
  console.warn(
    "[wallet-engine] inert simulation-only transfer worker started; settlement is disabled"
  );
} else {
  console.warn(
    `[wallet-engine] transfer worker not started (mode: ${transferExecutionMode})`
  );
}
