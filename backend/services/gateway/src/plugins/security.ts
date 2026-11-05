import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwt from '@fastify/jwt';
import helmet from '@fastify/helmet';
import csrf from '@fastify/csrf-protection';
import fp from 'fastify-plugin';

const JWT_ACCESS_TTL = '10m';
const JWT_REFRESH_TTL = '7d';

export const securityPlugin = fp(async function securityPlugin(app: FastifyInstance) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT secret must be provided by secret manager (Vault)');
  }

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(csrf, {
    cookieOpts: { sameSite: 'strict', httpOnly: true, secure: process.env.NODE_ENV === 'production' },
  });

  await app.register(jwt, {
    secret: jwtSecret,
    sign: { expiresIn: JWT_ACCESS_TTL },
  });

  app.decorate('mintTokens', async function mintTokens(userId: string, deviceId: string) {
    const accessToken = await app.jwt.sign({ sub: userId, deviceId, typ: 'access' });
    const refreshToken = await app.jwt.sign({ sub: userId, deviceId, typ: 'refresh' }, { expiresIn: JWT_REFRESH_TTL });
    return { accessToken, refreshToken };
  });

  app.decorate('rotateRefreshToken', async function rotateRefreshToken(refreshToken: string) {
    const payload = await app.jwt.verify<{ sub: string; deviceId: string; typ: string }>(refreshToken);
    if (payload.typ !== 'refresh') {
      throw new Error('Invalid token type');
    }

    const revokedKey = `revoked:${refreshToken}`;
    const revokedCount = await app.rateLimiter.incr(revokedKey);
    if (revokedCount > 1) {
      throw new Error('Refresh token revoked');
    }
    await app.rateLimiter.expire(revokedKey, JWT_REFRESH_TTL_SECONDS);
    return app.mintTokens(payload.sub, payload.deviceId);
  });

  app.decorate('authenticate', async function (req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
      if ((req as any).user?.typ !== 'access') {
        return reply.code(401).header('cache-control', 'no-store').send({ error: 'Unauthorized' });
      }
    } catch {
      return reply.code(401).header('cache-control', 'no-store').send({ error: 'Unauthorized' });
    }
  });

  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/health' || req.url.startsWith('/v1/auth/')) {
      return;
    }
    const nonce = req.headers['x-nonce'];
    if (!nonce || typeof nonce !== 'string') {
      reply.code(400).send({ error: 'Missing anti-replay nonce' });
      return;
    }

    const replayKey = `nonce:${nonce}`;
    const seen = await app.rateLimiter.incr(replayKey);
    if (seen > 1) {
      reply.code(409).send({ error: 'Replay detected' });
      return;
    }
    await app.rateLimiter.expire(replayKey, NONCE_TTL_SECONDS);
  });

  app.addHook('onRequest', async (req, reply) => {
    const key = `rl:${req.ip}`;
    const count = await app.rateLimiter.incr(key);
    if (count === 1) {
      await app.rateLimiter.expire(key, 60);
    }
    if (count > 120) {
      return reply.code(429).send({ error: 'Rate limit exceeded' });
    }
  });
});
const NONCE_TTL_SECONDS = 300;
const JWT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

declare module 'fastify' {
  interface FastifyInstance {
    replay: Set<string>;
    rateLimiter: { incr: (key: string) => Promise<number>; expire: (key: string, seconds: number) => Promise<number> };
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    mintTokens: (userId: string, deviceId: string) => Promise<{ accessToken: string; refreshToken: string }>;
    rotateRefreshToken: (refreshToken: string) => Promise<{ accessToken: string; refreshToken: string }>;
  }
}
