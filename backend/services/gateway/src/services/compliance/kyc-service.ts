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
    const res = await fetch(`${this.providerBase}/applicants`, {
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
