import "dotenv/config";
import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.PORT ?? 3005);

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

void app.listen({ port, host: "0.0.0.0" }).catch((error: unknown) => {
  app.log.error({ err: error }, "MPC service failed to start");
  process.exitCode = 1;
});
