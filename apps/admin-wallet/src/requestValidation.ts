import type { IncomingMessage } from "node:http";

export const MAX_JSON_BODY_BYTES = 64 * 1024;

export type JsonBodyError =
  | "unsupported_media_type"
  | "invalid_content_length"
  | "payload_too_large"
  | "invalid_json"
  | "request_error";

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413 | 415; error: JsonBodyError };

export async function readBoundedJson(req: IncomingMessage): Promise<JsonBodyResult> {
  const rawContentType = req.headers["content-type"];
  const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();

  if (mediaType !== "application/json") {
    req.resume();
    return { ok: false, status: 415, error: "unsupported_media_type" };
  }

  const rawContentLength = req.headers["content-length"];
  if (typeof rawContentLength === "string") {
    const normalizedLength = rawContentLength.trim();
    const declaredLength = Number(normalizedLength);
    if (
      !/^\d+$/.test(normalizedLength) ||
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0
    ) {
      req.resume();
      return { ok: false, status: 400, error: "invalid_content_length" };
    }
    if (declaredLength > MAX_JSON_BODY_BYTES) {
      req.resume();
      return { ok: false, status: 413, error: "payload_too_large" };
    }
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  let tooLarge = false;

  try {
    for await (const chunk of req) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      if (tooLarge) {
        continue;
      }
      if (bytes + data.byteLength > MAX_JSON_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        continue;
      }
      bytes += data.byteLength;
      chunks.push(data);
    }
  } catch {
    return { ok: false, status: 400, error: "request_error" };
  }

  if (tooLarge) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }

  try {
    const text = Buffer.concat(chunks).toString("utf8");
    return { ok: true, value: JSON.parse(text || "{}") as unknown };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}
