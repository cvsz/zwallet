import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_PREVIEW_BODY_BYTES = 16 * 1024;
export const PREVIEW_REQUEST_TIMEOUT_MS = 10_000;

type PreviewBuilder = (input: unknown) => unknown;

function reply(res: ServerResponse, status: number, body: unknown, close = false): void {
  if (res.writableEnded || res.headersSent) return;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(close ? { connection: "close" } : {}),
  });
  res.end(JSON.stringify(body));
}

/**
 * Accept only bounded JSON requests. Never expose parser/validation exceptions,
 * and never invoke signing or broadcasting from this read-only preview route.
 */
export function handleTransferPreview(
  req: IncomingMessage,
  res: ServerResponse,
  buildPreview: PreviewBuilder
): void {
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    reply(res, 415, { ok: false, error: "unsupported_media_type" }, true);
    req.pause();
    return;
  }

  const contentLength = req.headers["content-length"];
  if (contentLength !== undefined) {
    if (typeof contentLength !== "string" || !/^\d+$/.test(contentLength)) {
      reply(res, 400, { ok: false, error: "invalid_content_length" }, true);
      req.pause();
      return;
    }
    if (Number(contentLength) > MAX_PREVIEW_BODY_BYTES) {
      reply(res, 413, { ok: false, error: "payload_too_large" }, true);
      req.pause();
      return;
    }
  }

  let completed = false;
  let bytes = 0;
  const chunks: Buffer[] = [];
  const fail = (status: number, error: string): void => {
    if (completed) return;
    completed = true;
    reply(res, status, { ok: false, error }, true);
    req.pause();
  };

  req.setTimeout(PREVIEW_REQUEST_TIMEOUT_MS, () => fail(408, "request_timeout"));
  req.on("data", (chunk: Buffer) => {
    if (completed) return;
    bytes += chunk.length;
    if (bytes > MAX_PREVIEW_BODY_BYTES) {
      fail(413, "payload_too_large");
      return;
    }
    chunks.push(chunk);
  });
  req.on("aborted", () => { completed = true; });
  req.on("error", () => fail(400, "request_error"));
  req.on("end", () => {
    if (completed) return;
    completed = true;
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
    } catch {
      reply(res, 400, { ok: false, error: "invalid_json" });
      return;
    }
    try {
      reply(res, 200, { ok: true, preview: buildPreview(input) });
    } catch {
      reply(res, 400, { ok: false, error: "invalid_transfer_request" });
    }
  });
}
