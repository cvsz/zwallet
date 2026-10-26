import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

const SIGNING_UNAVAILABLE = { error: "mpc_signing_unavailable" };

export function buildApp() {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      serializers: {
        req: (request) => ({
          method: request.method,
          url: request.url,
          ip: request.ip,
        }),
      },
    },
  });

  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  app.get("/health", async () => ({
    service: "mpc-service",
    status: "ok",
    signingEnabled: false,
  }));

  app.get("/ready", async (_request, reply) =>
    reply.code(503).send(SIGNING_UNAVAILABLE),
  );

  app.post("/v1/mpc/request-sign", async (_request, reply) =>
    reply.code(503).send(SIGNING_UNAVAILABLE),
  );

  app.post("/v1/mpc/participate", async (_request, reply) =>
    reply.code(503).send(SIGNING_UNAVAILABLE),
  );

  return app;
}
