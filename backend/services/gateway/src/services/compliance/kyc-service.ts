import { z } from 'zod';

const KycStart = z.object({ userId: z.string().uuid(), country: z.string().min(2).max(2) });
const KycWebhook = z.object({
  externalUserId: z.string().uuid(),
  reviewStatus: z.enum(['pending', 'approved', 'rejected']),
  level: z.enum(['basic', 'full']).optional(),
});

export class KycService {
  constructor(private readonly providerBase: string, private readonly apiKey: string) {}

  async start(input: unknown) {
    const req = KycStart.parse(input);
    if (
      !this.providerBase ||
      !this.apiKey ||
      this.apiKey === 'local-dev-key' ||
      this.apiKey !== this.apiKey.trim() ||
      /[\x00-\x1F\x7F]/.test(this.apiKey)
    ) {
      throw new Error('KYC_PROVIDER_UNAVAILABLE');
    }

    let providerUrl: URL;
    try {
      providerUrl = new URL(this.providerBase);
    } catch {
      throw new Error('KYC_PROVIDER_UNAVAILABLE');
    }
    const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(providerUrl.hostname);
    const localTestRuntime = ['development', 'test'].includes(process.env.NODE_ENV ?? '');
    if (
      !['https:', 'http:'].includes(providerUrl.protocol) ||
      providerUrl.username ||
      providerUrl.password ||
      providerUrl.search ||
      providerUrl.hash ||
      (providerUrl.protocol !== 'https:' && !(isLoopback && localTestRuntime))
    ) {
      throw new Error('KYC_PROVIDER_UNAVAILABLE');
    }

    const applicantsUrl = new URL('applicants', providerUrl.href.endsWith('/') ? providerUrl.href : `${providerUrl.href}/`);
    const res = await fetch(applicantsUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-Key': this.apiKey },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error('KYC_START_FAIL');
    return res.json();
  }

  webhookUpdate(payload: unknown) {
    const parsed = KycWebhook.parse(payload);
    if (parsed.reviewStatus === 'approved' && !parsed.level) {
      throw new Error('KYC_APPROVAL_LEVEL_REQUIRED');
    }
    const update = { userId: parsed.externalUserId, status: parsed.reviewStatus };
    return parsed.level ? { ...update, level: parsed.level } : update;
  }
}
