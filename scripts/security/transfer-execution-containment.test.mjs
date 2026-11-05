import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveTransferExecutionMode } from "../../services/wallet-engine/src/workers/transferExecutionPolicy.js";

const source = async (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

test("transfer execution is disabled unless exact simulation mode is selected", () => {
  for (const value of [
    undefined,
    "",
    "production",
    "staging",
    "test",
    "development",
    "live",
    "SIMULATION",
    "simulation ",
  ]) {
    assert.equal(resolveTransferExecutionMode(value), "disabled", String(value));
  }

  assert.equal(resolveTransferExecutionMode("simulation"), "simulation");
});

test("worker has no signing, broadcast, persistence, or settlement side effects", async () => {
  const worker = await source(
    "../../services/wallet-engine/src/workers/transferWorker.ts",
  );

  for (const forbidden of [
    "getTransferById",
    "updateTransferStatus",
    "allocateNonce",
    "getSigningKeyForAddress",
    "appendSigningAudit",
    "signTransfer",
    "broadcastTransfer",
    "createPendingTransaction",
    "markPendingConfirmed",
  ]) {
    assert.equal(worker.includes(forbidden), false, forbidden);
  }

  assert.match(worker, /transferExecutionMode\s*===\s*"simulation"/);
  assert.match(worker, /status:\s*"simulation_only"/);
  assert.match(worker, /settlementEligible:\s*false/);
});

test("chain adapters cannot manufacture transaction hashes", async () => {
  const paths = [
    "../../services/wallet-engine/src/adapters/evm/realAdapter.ts",
    "../../services/wallet-engine/src/chains/evm/index.ts",
    "../../services/wallet-engine/src/chains/solana/index.ts",
    "../../services/wallet-engine/src/chains/bitcoin/index.ts",
  ];

  for (const path of paths) {
    const adapter = await source(path);
    assert.match(adapter, /throw new Error\(/, path);
    assert.doesNotMatch(adapter, /createHash|randomBytes|txHash\s*:/, path);
  }
});

test("confirmation helpers fail closed without verified chain finality", async () => {
  const queue = await source(
    "../../services/wallet-engine/src/services/transfers/transferQueue.ts",
  );
  const pending = await source(
    "../../services/wallet-engine/src/repositories/postgres/pendingTransactions.ts",
  );
  const transfers = await source(
    "../../services/wallet-engine/src/repositories/postgres/transfers.ts",
  );

  assert.doesNotMatch(queue, /simulated-\$\{transfer\.id\}/);
  assert.match(queue, /independently verified chain finality/);
  assert.match(pending, /chain-specific finality verifier/);
  assert.match(transfers, /if \(status === "confirmed"\)/);
});

test("worker runner does not keep an inactive worker process alive", async () => {
  const runner = await source(
    "../../services/wallet-engine/src/runTransferWorker.ts",
  );

  assert.match(runner, /transferExecutionMode/);
  assert.doesNotMatch(runner, /setInterval|setTimeout/);
});
