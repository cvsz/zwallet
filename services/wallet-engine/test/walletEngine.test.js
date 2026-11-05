import test from "node:test";
import assert from "node:assert/strict";
import { buildTransferDigest } from "../dist/walletEngine.js";

test("buildTransferDigest returns digest and stable canonical payload", () => {
  const input = {
    chain: "evm",
    from: "0x1234567890abcdef1234567890abcdef12345678",
    to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    amountAtomic: "1000000000000000000",
    nonce: 4,
    createdAt: "2026-05-03T00:00:00.000Z",
  };

  const result = buildTransferDigest(input);
  assert.match(result.id, /^[0-9a-f-]{36}$/i);
  assert.equal(result.digest.length, 64);
  assert.equal(typeof result.canonical, "string");
});

test("buildTransferDigest rejects invalid chain", () => {
  assert.throws(
    () =>
      buildTransferDigest({
        chain: "doge",
        from: "1234567890",
        to: "1234567899",
        amountAtomic: "10",
      }),
    /Unsupported chain/
  );
});
