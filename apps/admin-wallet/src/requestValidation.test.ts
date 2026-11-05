import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import {
  MAX_JSON_BODY_BYTES,
  readBoundedJson,
} from "./requestValidation.js";

function makeRequest(
  contentType: string | undefined,
  chunks: Buffer[],
  contentLength?: string,
): IncomingMessage {
  const request = Readable.from(chunks);
  const headers: Record<string, string> = {};
  if (contentType !== undefined) headers["content-type"] = contentType;
  if (contentLength !== undefined) headers["content-length"] = contentLength;
  Object.assign(request, { headers });
  return request as unknown as IncomingMessage;
}

test("accepts valid JSON within the configured limit", async () => {
  const result = await readBoundedJson(
    makeRequest("application/json; charset=utf-8", [Buffer.from('{"mode":"preview"}')]),
  );
  assert.deepEqual(result, { ok: true, value: { mode: "preview" } });
});

test("rejects requests without JSON content type", async () => {
  const result = await readBoundedJson(makeRequest("text/plain", [Buffer.from("{}")]));
  assert.deepEqual(result, {
    ok: false,
    status: 415,
    error: "unsupported_media_type",
  });
});

test("rejects a declared oversized body before parsing", async () => {
  const result = await readBoundedJson(
    makeRequest("application/json", [Buffer.from("{}")], String(MAX_JSON_BODY_BYTES + 1)),
  );
  assert.deepEqual(result, {
    ok: false,
    status: 413,
    error: "payload_too_large",
  });
});

test("rejects a streamed oversized body without retaining it in memory", async () => {
  const result = await readBoundedJson(
    makeRequest("application/json", [
      Buffer.alloc(MAX_JSON_BODY_BYTES),
      Buffer.from("x"),
    ]),
  );
  assert.deepEqual(result, {
    ok: false,
    status: 413,
    error: "payload_too_large",
  });
});

test("rejects invalid content length metadata", async () => {
  const result = await readBoundedJson(
    makeRequest("application/json", [Buffer.from("{}")], "not-a-number"),
  );
  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "invalid_content_length",
  });
});

test("rejects malformed JSON", async () => {
  const result = await readBoundedJson(makeRequest("application/json", [Buffer.from("{")]));
  assert.deepEqual(result, {
    ok: false,
    status: 400,
    error: "invalid_json",
  });
});
