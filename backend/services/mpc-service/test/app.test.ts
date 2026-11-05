import assert from "node:assert/strict";
import { after, test } from "node:test";
import { buildApp } from "../src/app.ts";

const app = buildApp();

after(async () => {
  await app.close();
});

test("health reports liveness without claiming signing readiness", async () => {
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    service: "mpc-service",
    status: "ok",
    signingEnabled: false,
  });
});

test("readiness fails closed until an audited signer is configured", async () => {
  const response = await app.inject({ method: "GET", url: "/ready" });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "mpc_signing_unavailable" });
});

test("request-sign never creates a simulated signature", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/mpc/request-sign",
    payload: {
      payload: "deadbeef",
      threshold: 2,
      participants: ["participant-a", "participant-b"],
      attestationToken: "attest_v2_fake",
    },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "mpc_signing_unavailable" });
  assert.equal("signature" in response.json(), false);
});

test("participation never accepts a simulated share", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/mpc/participate",
    payload: {
      requestId: "fake-request",
      participantId: "participant-a",
      shareHex: "deadbeef",
      attestationToken: "attest_v2_fake",
    },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "mpc_signing_unavailable" });
  assert.equal("signature" in response.json(), false);
});
