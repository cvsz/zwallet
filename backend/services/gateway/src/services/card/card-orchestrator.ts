import { z } from 'zod';
import type { OfframpService } from '../liquidity/offramp-service.js';
import type { RiskEngine } from '../risk/risk-engine.js';

const IssueReq = z.object({
  userId: z.string().uuid(),
  kycLevel: z.enum(['none', 'basic', 'full']),
  type: z.enum(['virtual', 'physical']),
  currency: z.enum(['USD', 'EUR', 'THB']),
});

const AuthEvent = z.object({
  userId: z.string().uuid(),
  cardId: z.string().min(6),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  mcc: z.string().min(3),
  merchant: z.string().min(2),
  authId: z.string().min(6),
});

export class CardOrchestrator {
  constructor(
    private readonly issuerBase: string,
    private readonly apiKey: string,
    private readonly risk: RiskEngine,
    private readonly liquidity: OfframpService
  ) {}

  async issueCard(input: unknown) {
    const req = IssueReq.parse(input);
    if (req.kycLevel !== 'full') throw new Error('KYC_FULL_REQUIRED');
    return this.callIssuer('/cards', req);
  }

  async handleAuth(eventRaw: unknown) {
    const ev = AuthEvent.parse(eventRaw);
    const risk = await this.risk.evaluate(ev);
    if (!risk.allow) return { decision: 'decline', reason: risk.reason ?? 'RISK' };

    const funded = await this.liquidity.preFund(ev.userId, ev.amount, ev.currency);
    if (!funded) return { decision: 'decline', reason: 'INSUFFICIENT_LIQUIDITY' };
    return { decision: 'approve' };
  }

  async freeze(cardId: string) {
    await this.callIssuer(`/cards/${encodeURIComponent(cardId)}/freeze`, undefined, 'POST');
    return true;
  }

  private async callIssuer(path: string, payload?: unknown, method = 'POST') {
    if (
      !this.issuerBase ||
      !this.apiKey ||
      this.apiKey === 'local-dev-key' ||
      this.apiKey !== this.apiKey.trim() ||
      /[\x00-\x1F\x7F]/.test(this.apiKey)
    ) {
      throw new Error('ISSUER_UNAVAILABLE');
    }

    let issuerUrl: URL;
    try {
      const baseUrl = new URL(this.issuerBase);
      const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
      const localTestRuntime = ['development', 'test'].includes(process.env.NODE_ENV ?? '');
      if (
        !['https:', 'http:'].includes(baseUrl.protocol) ||
        baseUrl.username ||
        baseUrl.password ||
        baseUrl.search ||
        baseUrl.hash ||
        (baseUrl.protocol !== 'https:' && !(isLoopback && localTestRuntime))
      ) {
        throw new Error('ISSUER_UNAVAILABLE');
      }

      const baseHref = baseUrl.href.endsWith('/') ? baseUrl.href : `${baseUrl.href}/`;
      issuerUrl = new URL(path.replace(/^\/+/, ''), baseHref);
      if (issuerUrl.origin !== baseUrl.origin) throw new Error('ISSUER_UNAVAILABLE');
    } catch {
      throw new Error('ISSUER_UNAVAILABLE');
    }

    const res = await fetch(issuerUrl, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      if (res.body) await res.body.cancel().catch(() => undefined);
      throw new Error('ISSUER_REDIRECT_DENIED');
    }
    if (!res.ok) throw new Error(`ISSUER_ERROR_${res.status}`);
    return res.json();
  }
}
