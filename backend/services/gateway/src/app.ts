import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { Redis } from 'ioredis';
import { cardFreezeSchema, cardIssueSchema, deviceBindSchema, issuerAuthWebhookSchema, kycStartSchema, lifecycleCreateSchema, loginSchema, priceSchema, refreshSchema, registerSchema, swapRequestSchema, txIndexSchema, walletMetadataSchema } from './schemas/index.js';
import { securityPlugin } from './plugins/security.js';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { RpcProviderPool } from './lib/rpc-provider-pool.js';
import { InMemoryBundlerClient, UserOperationService } from './services/bundler.js';
import { GatewayStateStore, type TxLifecycleState, type TxStep } from './services/state-store.js';
import { hashPassword, verifyPassword } from './services/password.js';
import { store } from './utils/store.js';
import { mpcServiceConfigSchema, mpcRequestSchema, MpcSignerService, SandboxMpcProvider } from './services/mpc.js';
import { RiskEngine } from './services/risk/risk-engine.js';
import { OfframpService } from './services/liquidity/offramp-service.js';
import { CardOrchestrator } from './services/card/card-orchestrator.js';
import { KycService } from './services/compliance/kyc-service.js';

const CLAIM_ISSUER_AUTH_EVENT_LUA = [
  "if redis.call('EXISTS', KEYS[1]) == 1 then",
  "  return {0, 'replay'}",
  "end",
  "local existing = redis.call('GET', KEYS[2])",
  "if existing then",
  "  local nonceClaim = redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX')",
  "  if not nonceClaim then return {0, 'replay'} end",
  "  return {2, existing}",
  "end",
  "local eventClaim = redis.call('SET', KEYS[2], ARGV[2], 'NX')",
  "if not eventClaim then return {2, redis.call('GET', KEYS[2]) or ''} end",
  "local nonceClaim = redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX')",
  "if not nonceClaim then",
  "  redis.call('DEL', KEYS[2])",
  "  return {0, 'replay'}",
  "end",
  "return {1, 'OK'}",
].join('\n');

type Deps = {
  rateLimiter?: { incr: (k: string) => Promise<number>; expire: (k: string, s: number) => Promise<number> };
  cache?: {
    get: (k: string) => Promise<string | null>;
    setex: (k: string, s: number, v: string) => Promise<unknown>;
    set?: (k: string, v: string, ...args: string[]) => Promise<string | null>;
    eval?: (script: string, numberOfKeys: number, ...args: Array<string | number>) => Promise<unknown>;
  };
};

const isLifecycleSimulationEnabled = () =>
  ['development', 'test'].includes(process.env.NODE_ENV ?? '') &&
  process.env.WALLET_ENABLE_TRANSACTION_LIFECYCLE_SIMULATION === 'true';

const isSandboxMpcAaEnabled = () =>
  ['development', 'test'].includes(process.env.NODE_ENV ?? '') &&
  process.env.WALLET_ENABLE_SANDBOX_MPC_AA === 'true';

export const buildApp = (deps: Deps = {}) => {
  const app = Fastify({ logger: false });
  const redis = deps.rateLimiter && deps.cache ? null : new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true });
  const rateLimiter = deps.rateLimiter ?? (redis as any);
  const cache = deps.cache ?? (redis as any);
  const state = new GatewayStateStore((redis ?? deps.cache) as any);
  const rpcPool = new RpcProviderPool([{ id: 'rpc-a', call: async () => ({ price: Number((Math.random()*1000).toFixed(2)), block: 100 }) }, { id: 'rpc-b', call: async () => ({ price: Number((Math.random()*1000).toFixed(2)), block: 100 }) }, { id: 'rpc-c', call: async () => ({ price: Number((Math.random()*1000).toFixed(2)), block: 99 }) }], 2, { onQuorumDisagreement: (e) => app.log.warn({ event: 'rpc_quorum_disagreement', method: e.method }) });
  const mpcCfg = mpcServiceConfigSchema.parse({ provider: process.env.MPC_PROVIDER, timeoutMs: Number(process.env.MPC_TIMEOUT_MS ?? 500) });
  const mpcSigner = new MpcSignerService(new SandboxMpcProvider());
  const userOpService = new UserOperationService(new InMemoryBundlerClient());
  const riskEngine = new RiskEngine();
  const offrampService = new OfframpService((process.env.RFQ_ENDPOINTS ?? '').split(',').filter(Boolean), { credit: async () => undefined });
  const cardOrchestrator = new CardOrchestrator(process.env.ISSUER_BASE ?? '', process.env.ISSUER_KEY ?? '', riskEngine, offrampService);
  const kycService = new KycService(process.env.KYC_PROVIDER_BASE ?? '', process.env.KYC_PROVIDER_KEY ?? '');

  app.register(cors, { origin: true });
  if (redis) {
    app.addHook('onClose', async () => {
      await redis.quit();
    });
  }
  app.decorate('replay', new Set<string>());
  app.decorate('rateLimiter', rateLimiter as any);
  app.register(securityPlugin);
  app.addHook('onRequest', async (req: any, reply) => {
    const key = `rl:global:${req.ip}`;
    const count = await rateLimiter.incr(key);
    if (count === 1) await rateLimiter.expire(key, 60);
    if (count > 240) return reply.code(429).send({ error: 'rate_limit_exceeded' });
  });

  const authGuard = async (req: any, reply: any) => (app as any).authenticate(req, reply);
  app.setErrorHandler((error, _req, reply) => {
    app.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });
  app.get('/health', async () => ({ service: 'gateway', status: 'ok' }));
  app.post('/v1/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const suppliedIdempotencyKey = req.headers['idempotency-key'];
    if (
      suppliedIdempotencyKey !== undefined &&
      (typeof suppliedIdempotencyKey !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(suppliedIdempotencyKey))
    ) {
      return reply.code(400).send({ error: 'invalid_idempotency_key' });
    }
    const requestKey = typeof suppliedIdempotencyKey === 'string' ? suppliedIdempotencyKey : randomUUID();
    const idempotencyDigest = createHash('sha256')
      .update(`${parsed.data.email}\0${requestKey}`)
      .digest('hex');
    const fingerprintSecret = process.env.IDEMPOTENCY_FINGERPRINT_SECRET ?? process.env.JWT_SECRET;
    if (!fingerprintSecret) return reply.code(503).send({ error: 'idempotency_unavailable' });
    const requestFingerprint = createHmac('sha256', fingerprintSecret)
      .update('zwallet:registration-idempotency:v1:')
      .update(JSON.stringify({
        email: parsed.data.email,
        password: parsed.data.password,
        deviceId: parsed.data.deviceId,
      }))
      .digest('hex');

    try {
      const { result } = await state.withIdempotency(`auth:register:${idempotencyDigest}`, 300, async () => {
        const passwordHash = await hashPassword(parsed.data.password);
        const user = await state.createUser(parsed.data.email, passwordHash, parsed.data.deviceId);
        if (!user) return { conflict: true as const };
        await state.appendAudit('auth.register', user.id, { email: parsed.data.email, deviceId: parsed.data.deviceId });
        return { conflict: false as const, userId: user.id };
      }, requestFingerprint);
      if (result.conflict) return reply.code(409).send({ error: 'account_already_exists' });
      return reply.send({ userId: result.userId });
    } catch (error) {
      if (error instanceof Error && error.message === 'idempotency_payload_conflict') {
        return reply.code(409).send({ error: 'idempotency_key_reused' });
      }
      if (error instanceof Error && error.message === 'idempotency_conflict') {
        return reply.code(409).send({ error: 'registration_in_progress' });
      }
      throw error;
    }
  });

  app.post('/v1/auth/device/bind', { preHandler: [authGuard] }, async (req: any, reply) => {
    const parsed = deviceBindSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.userId !== req.user.sub) {
      return reply.code(403).header('cache-control', 'no-store').send({ error: 'user_mismatch' });
    }

    await state.bindDevice(req.user.sub, parsed.data.deviceId);
    const deviceDigest = createHash('sha256').update(parsed.data.deviceId).digest('hex');
    await state.appendAudit('auth.device.bind', req.user.sub, { deviceIdDigest: deviceDigest });
    return reply.header('cache-control', 'no-store').send({ bound: true });
  });
  app.post('/v1/auth/refresh', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return await (app as any).rotateRefreshToken((parsed.data as any).refreshToken);
    } catch {
      return reply.code(401).send({ error: 'Invalid refresh token' });
    }
  });
  app.post('/v1/auth/login', async (req, reply) => { const parsed = loginSchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() }); const email = parsed.data.email; const password = parsed.data.password; let user = await state.getUser(email); if (!user) return reply.code(401).send({ error: 'Invalid credentials' }); let authenticated = false; if (user.passwordHash) {
      authenticated = await verifyPassword(password, user.passwordHash);
      if (authenticated && user.legacyPassword !== null && user.legacyPassword !== undefined) {
        await state.removeLegacyPasswordAfterHashAuthentication(email, user.passwordHash);
      }
    } else if (user.legacyPassword !== null && user.legacyPassword !== undefined && user.legacyPassword === password) { const upgradedHash = await hashPassword(password); await state.migrateLegacyPassword(email, password, upgradedHash); user = await state.getUser(email); authenticated = Boolean(user?.passwordHash && await verifyPassword(password, user.passwordHash)); } if (!authenticated || !user) return reply.code(401).send({ error: 'Invalid credentials' }); if (!(await state.hasDevice(user.id, parsed.data.deviceId))) return reply.code(403).send({ error: 'Unbound device' }); const tokens = await (app as any).mintTokens(user.id, parsed.data.deviceId); await state.appendAudit('auth.login', user.id, { deviceId: parsed.data.deviceId }); return tokens; });
  app.post('/v1/wallet-metadata', { preHandler: [authGuard] }, async (req: FastifyRequest, reply: FastifyReply) => { const parsed = walletMetadataSchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() }); const item = { id: randomUUID(), userId: (req.user as any).sub, ...parsed.data }; store.wallets.push(item); store.audit.push({ action: 'wallet.create', userId: (req.user as any).sub, payload: item }); return item; });
  app.post('/v1/transactions/index', { preHandler: [authGuard] }, async (req: FastifyRequest, reply: FastifyReply) => { const parsed = txIndexSchema.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() }); const entry = { ...parsed.data, indexedAt: new Date().toISOString() }; store.txIndex.push(entry); store.audit.push({ action: 'tx.index', userId: (req.user as any).sub, payload: entry }); return { indexed: true, entry }; });
  app.post('/v1/swaps/orchestrate', { preHandler: [authGuard] }, async (req: FastifyRequest, reply: FastifyReply) => { 
    const parsed = swapRequestSchema.safeParse(req.body); 
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() }); 

    const aiBase = process.env.AI_SERVICE_URL ?? 'http://api:8000';
    
    let aiRecommendation = { urgency: 'medium', risk_score: 0.1 };
    try {
      const aiRes = await fetch(`${aiBase}/v1/ai/inference/swap-recommendation`, {
        method: 'POST',
        headers: { 
          'content-type': 'application/json',
          'Authorization': req.headers.authorization!
        },
        body: JSON.stringify({
          user_id: (req.user as any).sub,
          from_token: (parsed.data as any).fromToken,
          to_token: (parsed.data as any).toToken,
          amount: (parsed.data as any).amount,
          slippage_tolerance_bps: (parsed.data as any).slippageBps,
          urgency: (parsed.data as any).urgency || 'medium'
        })
      });
      if (aiRes.ok) {
        aiRecommendation = await aiRes.json();
      }
    } catch (e) {
      app.log.warn({ event: 'ai_service_unavailable', error: e });
    }
    
    const swap = { 
      id: randomUUID(), 
      ...parsed.data, 
      amount: String((parsed.data as any).amount),
      status: 'quoted', 
      intelligence: aiRecommendation 
    }; 
    
    store.swaps.push(swap as any); 
    store.audit.push({ action: 'swap.orchestrate', userId: (req.user as any).sub, payload: swap }); 
    return swap; 
  });
  app.get('/v1/prices/:symbol', { preHandler: [authGuard] }, async (req: FastifyRequest, reply: FastifyReply) => { const parsed = priceSchema.safeParse(req.params); if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() }); const cacheKey = `price:${(parsed.data as any).symbol}`; const hit = await cache.get(cacheKey); if (hit) return { symbol: (parsed.data as any).symbol, price: Number(hit), source: 'cache' }; const quorumPrice = await rpcPool.call('eth_getBalance', [(parsed.data as any).symbol]) as { price: number }; const price = Number(quorumPrice.price.toFixed(2)); await cache.setex(cacheKey, 15, String(price)); await state.appendAudit('price.read', (req.user as any).sub, { symbol: (parsed.data as any).symbol, price }); return { symbol: (parsed.data as any).symbol, price, source: 'oracle' }; });
  app.get('/v1/audit-logs', { preHandler: [authGuard] }, async (req: any) => {
    const authenticatedUserId = req.user.sub;
    const items = await state.readAudit();
    return { items: items.filter((item: any) => item.userId === authenticatedUserId) };
  });

  app.post('/v1/compliance/kyc/start', { preHandler: [authGuard] }, async (req: any, reply) => {
    const parsed = kycStartSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.userId !== req.user.sub) {
      return reply.code(403).send({ error: 'user_mismatch' });
    }
    try {
      return await kycService.start({ ...parsed.data, userId: req.user.sub });
    } catch {
      return reply
        .code(503)
        .header('cache-control', 'no-store')
        .send({ error: 'kyc_provider_unavailable' });
    }
  });

  app.post('/v1/card/issue', { preHandler: [authGuard] }, async (req: any, reply) => {
    const parsed = cardIssueSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.userId !== req.user.sub) return reply.code(403).send({ error: 'user_mismatch' });

    // The request's kycLevel is client-controlled. The current KYC adapter only starts
    // provider applications; it has no verified, durable approval record to authorize issuance.
    return reply
      .code(503)
      .header('cache-control', 'no-store')
      .send({ error: 'kyc_approval_unavailable' });
  });

  app.post('/v1/webhooks/issuer/auth', async (req: any, reply) => {
    const webhookRateKey = `rl:webhook:issuer:${req.ip}`;
    const webhookCount = await rateLimiter.incr(webhookRateKey);
    if (webhookCount === 1) await rateLimiter.expire(webhookRateKey, 60);
    if (webhookCount > 60) return reply.code(429).send({ error: 'rate_limit_exceeded' });

    const signature = req.headers['x-issuer-signature'];
    const nonce = req.headers['x-issuer-nonce'];
    if (!signature || !nonce) return reply.code(401).send({ error: 'missing_webhook_signature' });
    if (typeof nonce !== 'string' || nonce.length > 256 || /[\s\x00-\x1F\x7F]/.test(nonce)) {
      return reply.code(400).send({ error: 'invalid_webhook_nonce' });
    }
    const webhookSecret = process.env.ISSUER_WEBHOOK_SECRET;
    // Fail closed on missing, weak, padded, or control-character secrets. Do not log key material.
    if (
      !webhookSecret ||
      webhookSecret !== webhookSecret.trim() ||
      Buffer.byteLength(webhookSecret, 'utf8') < 32 ||
      new Set(webhookSecret).size < 8 ||
      /[\x00-\x1F\x7F]/.test(webhookSecret)
    ) {
      return reply.code(503).send({ error: 'webhook_unavailable' });
    }
    const payload = JSON.stringify(req.body ?? {});
    const expected = createHmac('sha256', webhookSecret).update(`${String(nonce)}.${payload}`).digest('hex');
    const provided = String(signature);
    if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return reply.code(401).send({ error: 'invalid_webhook_signature' });
    }
    const parsed = issuerAuthWebhookSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    // Validate stable issuer identity before consuming the transport nonce.
    // Otherwise a configuration error would lock out a legitimate provider retry.
    const issuerIdentity = process.env.ISSUER_ID;
    if (!issuerIdentity || issuerIdentity !== issuerIdentity.trim() || !/^[A-Za-z0-9._:-]{1,128}$/.test(issuerIdentity)) {
      return reply.code(503).send({ error: 'issuer_auth_idempotency_unavailable' });
    }

    // The shared hash tag keeps both keys in one Redis Cluster slot for the Lua transaction.
    const issuerKeyTag = '{' + issuerIdentity + '}';
    const nonceKey = 'issuer:webhook:' + issuerKeyTag + ':nonce:' + String(nonce);
    const authEventPayloadHash = createHash('sha256')
      .update(JSON.stringify(parsed.data))
      .digest('hex');
    const authEventFingerprint = createHash('sha256')
      .update(issuerIdentity + '\u0000' + parsed.data.authId)
      .digest('hex');
    const authEventKey = 'issuer:webhook:' + issuerKeyTag + ':auth:' + authEventFingerprint;
    const processingRecord = JSON.stringify({
      status: 'processing',
      payloadHash: authEventPayloadHash,
      startedAt: new Date().toISOString(),
    });

    if (typeof cache.eval !== 'function') {
      return reply.code(503).send({ error: 'webhook_replay_protection_unavailable' });
    }

    let claim: unknown;
    try {
      claim = await cache.eval(
        CLAIM_ISSUER_AUTH_EVENT_LUA,
        2,
        nonceKey,
        authEventKey,
        '300',
        processingRecord,
      );
    } catch {
      return reply.code(503).send({ error: 'issuer_auth_idempotency_unavailable' });
    }

    if (!Array.isArray(claim) || claim.length !== 2) {
      return reply.code(503).send({ error: 'issuer_auth_idempotency_unavailable' });
    }
    const claimCode = Number(claim[0]);
    const claimValue = typeof claim[1] === 'string' ? claim[1] : '';
    if (claimCode === 0) return reply.code(409).send({ error: 'replay_detected' });

    if (claimCode === 2) {
      let existing: { status?: unknown; payloadHash?: unknown; result?: unknown };
      try {
        const decoded: unknown = JSON.parse(claimValue);
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
          return reply.code(503).send({ error: 'issuer_auth_idempotency_unavailable' });
        }
        existing = decoded as { status?: unknown; payloadHash?: unknown; result?: unknown };
      } catch {
        return reply.code(503).send({ error: 'issuer_auth_idempotency_unavailable' });
      }
      if (existing.payloadHash !== authEventPayloadHash) {
        return reply.code(409).send({ error: 'issuer_auth_id_conflict' });
      }
      if (existing.status === 'completed' && existing.result && typeof existing.result === 'object' && !Array.isArray(existing.result)) {
        return reply.code(200).send(existing.result);
      }
      if (existing.status === 'processing') {
        return reply.header('retry-after', '5').code(503).send({ error: 'issuer_auth_in_progress' });
      }
      return reply.code(503).send({ error: 'issuer_auth_idempotency_unavailable' });
    }

    if (claimCode !== 1 || claimValue !== 'OK') {
      return reply.code(503).send({ error: 'issuer_auth_idempotency_unavailable' });
    }

    let result: unknown;
    try {
      result = await cardOrchestrator.handleAuth(parsed.data);
    } catch {
      // The handler may have completed a downstream side effect before failing.
      // Keep the processing claim and require reconciliation; never auto-replay it.
      app.log.error({ event: 'issuer_auth_outcome_unknown', authEventFingerprint });
      return reply.code(503).send({ error: 'issuer_auth_outcome_unknown' });
    }

    try {
      const saved = await cache.set(
        authEventKey,
        JSON.stringify({ status: 'completed', payloadHash: authEventPayloadHash, result, completedAt: new Date().toISOString() }),
      );
      if (saved !== 'OK') throw new Error('issuer_auth_result_not_persisted');
    } catch {
      // Leave the original processing claim in place if result persistence fails.
      app.log.error({ event: 'issuer_auth_result_persistence_failed', authEventFingerprint });
      return reply.code(503).send({ error: 'issuer_auth_outcome_unknown' });
    }

    return reply.code(200).send(result);
  });

  app.post('/v1/card/:id/freeze', { preHandler: [authGuard] }, async (req: any, reply) => {
    const parsed = cardFreezeSchema.safeParse(req.params);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    // The gateway has no durable cardId -> owner binding. Do not call the privileged issuer
    // API with a caller-selected card ID until the provider contract enforces owner scope.
    return reply
      .code(503)
      .header('cache-control', 'no-store')
      .send({ error: 'card_owner_verification_unavailable' });
  });

  app.post('/v1/transactions/lifecycle', { preHandler: [authGuard] }, async (req: any, reply) => {
    const parsed = lifecycleCreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    if (!isLifecycleSimulationEnabled()) {
      return reply
        .code(503)
        .header('cache-control', 'no-store')
        .send({ error: 'transaction_lifecycle_simulation_disabled' });
    }

    const txId = randomUUID();
    const txBase = process.env.TX_ORCHESTRATOR_URL ?? 'http://tx-orchestrator:8091';
    const indexerBase = process.env.INDEXER_SERVICE_URL ?? 'http://indexer-service:8093';

    const payload = {
      chain: parsed.data.chain,
      from: parsed.data.from,
      to: parsed.data.to,
      value: parsed.data.value,
      replayProtection: parsed.data.chain === 'evm'
        ? { chainId: 1 }
        : parsed.data.chain === 'solana'
          ? { recentBlockhash: 'recent-blockhash' }
          : { lockTime: Date.now() },
    };

    const lifecycleState: TxLifecycleState = {
      id: txId,
      userId: req.user.sub,
      payload,
      steps: [
        { step: 1, name: 'android_create_transaction', status: 'completed' },
        { step: 2, name: 'wallet_sign_locally', status: 'completed' },
      ],
      status: 'created',
    };

    const verifyRes = await fetch(`${txBase}/v1/tx/verify-signature`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload, signatureHex: parsed.data.signatureHex, signerId: parsed.data.from }),
    });
    if (!verifyRes.ok) {
      lifecycleState.steps = [...lifecycleState.steps, { step: 3, name: 'backend_validate_request', status: 'failed', error: 'invalid_signature' }];
      lifecycleState.status = 'failed';
      await state.writeTxLifecycle(txId, lifecycleState);
      return reply.code(400).send({ error: 'invalid_signature', txId, state: lifecycleState });
    }

    lifecycleState.steps = [...lifecycleState.steps, { step: 3, name: 'backend_validate_request', status: 'completed' }];
    const senderBalance = store.balances.get(parsed.data.from) ?? 100;
    const value = Number(parsed.data.value);
    if (!Number.isFinite(value) || value <= 0 || senderBalance < value) {
      lifecycleState.steps = [...lifecycleState.steps, { step: 4, name: 'transaction_broadcast_to_chain', status: 'failed', error: 'insufficient_balance' }];
      lifecycleState.status = 'failed';
      await state.writeTxLifecycle(txId, lifecycleState);
      return reply.code(400).send({ error: 'insufficient_balance', txId, state: lifecycleState, available: senderBalance });
    }

    if (parsed.data.forceRpcFailure) {
      lifecycleState.steps = [...lifecycleState.steps, { step: 4, name: 'transaction_broadcast_to_chain', status: 'failed', error: 'rpc_failure' }];
      lifecycleState.status = 'failed';
      await state.writeTxLifecycle(txId, lifecycleState);
      return reply.code(502).send({ error: 'rpc_failure', txId, state: lifecycleState });
    }

    const txHash = createHash('sha256').update(`${txId}:${Date.now()}`).digest('hex');
    lifecycleState.steps = [...lifecycleState.steps, { step: 4, name: 'transaction_broadcast_to_chain', status: 'completed', txHash }];

    await fetch(`${indexerBase}/indexer/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobs: [{ idempotencyKey: `${txId}:${req.user.sub}`, chain: parsed.data.chain === 'evm' ? 'evm' : parsed.data.chain === 'solana' ? 'solana' : 'bitcoin', addresses: [parsed.data.from, parsed.data.to], cursor: txHash }] }),
    });

    lifecycleState.steps = [...lifecycleState.steps, { step: 5, name: 'indexer_detects_transaction', status: 'completed' }];
    store.balances.set(parsed.data.from, senderBalance - value);
    store.balances.set(parsed.data.to, (store.balances.get(parsed.data.to) ?? 0) + value);

    lifecycleState.steps = [...lifecycleState.steps, { step: 6, name: 'api_returns_updated_state', status: 'completed' }, { step: 7, name: 'android_reflects_state', status: 'completed' }];
    lifecycleState.status = 'confirmed';
    lifecycleState.updatedBalances = { from: store.balances.get(parsed.data.from), to: store.balances.get(parsed.data.to) };
    await state.writeTxLifecycle(txId, lifecycleState);

    return { txId, state: lifecycleState };
  });

  app.get('/v1/transactions/lifecycle/:txId', { preHandler: [authGuard] }, async (req: any, reply) => {
    if (!isLifecycleSimulationEnabled()) {
      return reply
        .code(503)
        .header('cache-control', 'no-store')
        .send({ error: 'transaction_lifecycle_simulation_disabled' });
    }

    const tx = await state.readTxLifecycle(req.params.txId);
    if (!tx || tx.userId !== req.user.sub) return reply.code(404).send({ error: 'not_found' });
    return { txId: req.params.txId, state: tx };
  });

  app.post('/v1/mpc/sign-transaction', { preHandler: [authGuard] }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isSandboxMpcAaEnabled()) {
      return reply
        .code(503)
        .header('cache-control', 'no-store')
        .send({ error: 'sandbox_mpc_aa_disabled' });
    }

    const parsed = mpcRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    
    try {
      // Simulation: Orchestrate ceremony
      const mpcRequestId = `mpc_${randomUUID().slice(0, 8)}`;
      await state.appendAudit('mpc.sign', (req.user as any).sub, { mpcRequestId });
      return { mpcRequestId, status: 'initiated' };
    } catch (e: any) {
      return reply.code(502).send({ error: 'MPC coordination failed', detail: e.message });
    }
  });

  app.post('/v1/aa/user-operations', { preHandler: [authGuard] }, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isSandboxMpcAaEnabled()) {
      return reply
        .code(503)
        .header('cache-control', 'no-store')
        .send({ error: 'sandbox_mpc_aa_disabled' });
    }

    try {
      // Simulation: Build and submit UserOp
      const userOpHash = `0xop_${randomUUID().slice(0, 12)}`;
      await state.appendAudit('aa.userop', (req.user as any).sub, { userOpHash });
      return { userOpHash, status: 'submitted' };
    } catch (e: any) { 
      return reply.code(400).send({ error: e?.message ?? 'invalid_user_operation' }); 
    }
  });

  app.get('/v1/aa/user-operations/:userOpHash/status', { preHandler: [authGuard] }, async (req: any, reply: any) => {
    if (!isSandboxMpcAaEnabled()) {
      return reply
        .code(503)
        .header('cache-control', 'no-store')
        .send({ error: 'sandbox_mpc_aa_disabled' });
    }

    return { userOpHash: req.params.userOpHash, status: await userOpService.status(req.params.userOpHash) };
  });

  app.post('/v1/flow/wallet-sign-swap', { preHandler: [authGuard] }, async (req: any, reply) => {
    const parsed = swapRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const walletBase = process.env.WALLET_SERVICE_URL ?? 'http://wallet-service:8090';
    const policyBase = process.env.POLICY_SERVICE_URL ?? 'http://policy-service:8094';
    const swapBase = process.env.SWAP_SERVICE_URL ?? 'http://swap-service:8092';
    const indexerBase = process.env.INDEXER_SERVICE_URL ?? 'http://indexer-service:8093';
    const portfolioBase = process.env.PORTFOLIO_SERVICE_URL ?? 'http://portfolio-service:8095';

    const walletRes = await fetch(`${walletBase}/v1/wallets/default`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: req.user.sub, chain: parsed.data.chain }) });
    const wallet = await walletRes.json();

    const policyRes = await fetch(`${policyBase}/v1/policy/pre-sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: req.user.sub, chain: parsed.data.chain, amount: parsed.data.amount, fromToken: parsed.data.fromToken, toToken: parsed.data.toToken }) });
    const policy = await policyRes.json();
    if (!policyRes.ok) return reply.code(403).send({ stage: 'sign', policy });

    const quoteRes = await fetch(`${swapBase}/v1/swaps/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: parsed.data.chain, tokenIn: parsed.data.fromToken, tokenOut: parsed.data.toToken, amountIn: parsed.data.amount, slippageBps: parsed.data.slippageBps }) });
    const quoteBody = await quoteRes.json();
    if (!quoteRes.ok) return reply.code(400).send({ stage: 'swap', error: quoteBody });

    const routeId = quoteBody.quote?.routeId;
    const executeRes = await fetch(`${swapBase}/v1/swaps/execute`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ routeId, walletAddress: wallet.address }) });
    const executeBody = await executeRes.json();
    if (!executeRes.ok) return reply.code(400).send({ stage: 'broadcast', error: executeBody });

    const txHash = executeBody.tx?.hash;
    await fetch(`${indexerBase}/indexer/batch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobs: [{ idempotencyKey: `${txHash}:${req.user.sub}`, chain: parsed.data.chain === 'solana' ? 'solana' : parsed.data.chain === 'bitcoin' ? 'bitcoin' : 'evm', addresses: [wallet.address], cursor: txHash }] }) });

    const portfolioRes = await fetch(`${portfolioBase}/v1/portfolio/display`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: req.user.sub, chain: parsed.data.chain, walletAddress: wallet.address, txHash }) });
    const portfolio = await portfolioRes.json();

    return { flow: ['wallet', 'sign', 'swap', 'broadcast', 'index', 'display'], wallet, policy, quote: quoteBody.quote, execution: executeBody, portfolio };
  });

  return app;
};
