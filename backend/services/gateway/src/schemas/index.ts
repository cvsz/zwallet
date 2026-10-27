import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(1024),
  deviceId: z.string().min(8)
});

export const loginSchema = registerSchema;

export const walletMetadataSchema = z.object({
  walletLabel: z.string().min(2),
  network: z.string().min(2),
  address: z.string().min(8)
});

export const txIndexSchema = z.object({
  chain: z.string(),
  blockNumber: z.number().int().nonnegative(),
  txHash: z.string().min(10)
});

export const swapRequestSchema = z.object({
  chain: z.enum(['ethereum','solana','bitcoin', 'evm']),
  fromToken: z.string(),
  toToken: z.string(),
  amount: z.union([z.string(), z.number()]),
  slippageBps: z.number().int().min(1).max(1000),
  urgency: z.enum(['low', 'medium', 'high']).optional()
});

export const priceSchema = z.object({
  symbol: z.string().min(2)
});

export const lifecycleCreateSchema = z.object({
  chain: z.enum(['evm', 'solana', 'bitcoin']),
  from: z.string().min(5),
  to: z.string().min(5),
  value: z.string(),
  signatureHex: z.string().min(10),
  forceRpcFailure: z.boolean().optional().default(false)
});


export const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

export const deviceBindSchema = z.object({
  userId: z.string().uuid(),
  deviceId: z.string().min(8)
});

export const cardIssueSchema = z.object({
  userId: z.string().uuid(),
  kycLevel: z.enum(['none', 'basic', 'full']),
  type: z.enum(['virtual', 'physical']),
  currency: z.enum(['USD', 'EUR', 'THB'])
});

export const cardFreezeSchema = z.object({ id: z.string().min(6) });

export const issuerAuthWebhookSchema = z.object({
  userId: z.string().uuid(),
  cardId: z.string().min(6),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  mcc: z.string().min(3),
  merchant: z.string().min(2),
  authId: z.string().min(6)
});

export const kycStartSchema = z.object({ userId: z.string().uuid(), country: z.string().min(2).max(2) });
