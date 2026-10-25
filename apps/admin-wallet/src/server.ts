import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { buildTransferDigest } from "@zwallet/wallet-engine/walletEngine";
import { readBoundedJson } from "./requestValidation.js";

const port = Number(process.env.PORT ?? 8081);

function sendJson(
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, service: "admin-wallet" });
    return;
  }

  if (req.method === "POST" && req.url === "/transfer/preview") {
    void readBoundedJson(req)
      .then((result) => {
        if (!result.ok) {
          sendJson(res, result.status, { ok: false, error: result.error });
          return;
        }

        try {
          const preview = buildTransferDigest(result.value);
          sendJson(res, 200, { ok: true, preview });
        } catch {
          sendJson(res, 400, { ok: false, error: "invalid_payload" });
        }
      })
      .catch(() => {
        if (!res.headersSent) {
          sendJson(res, 400, { ok: false, error: "request_error" });
        }
      });
    return;
  }

  sendJson(res, 404, { ok: false, error: "not_found" });
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;

server.listen(port, "0.0.0.0", () => {
  console.log("admin-wallet listening on :" + port);
});
