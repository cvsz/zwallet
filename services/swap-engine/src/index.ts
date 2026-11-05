import { MultiRpcPool, createFetchRpcClient, type RpcProvider } from '@zwallet/rpc';

const rpcProviders: RpcProvider[] = [
  { id: 'primary', chain: 'evm', url: process.env.RPC_EVM_PRIMARY ?? 'http://localhost:8545', priority: 120 },
  { id: 'secondary', chain: 'evm', url: process.env.RPC_EVM_SECONDARY ?? 'http://localhost:8546', priority: 100 },
  { id: 'solana-primary', chain: 'solana', url: process.env.RPC_SOLANA_PRIMARY ?? 'http://localhost:8899', priority: 110 },
  { id: 'btc-primary', chain: 'btc', url: process.env.RPC_BTC_PRIMARY ?? 'http://localhost:8332', priority: 110 },
];

export const rpcPool = new MultiRpcPool(rpcProviders, createFetchRpcClient);

export type Chain = 'evm' | 'solana' | 'bitcoin';

export interface SwapQuoteRequest {
  chain: Chain;
  fromToken: string;
  toToken: string;
  amountInAtomic: string;
  maxSlippageBps: number;
  gasPriceGwei: string;
}

export interface RouteCandidate {
  routeId: string;
  provider: 'dex' | 'rfq';
  expectedOutAtomic: string;
  gasUnits: bigint;
  estimatedLatencyMs: number;
  slippageBps: number;
  simulationOk: boolean;
}

export interface RankedRoute extends RouteCandidate {
  score: number;
  gasCostAtomic: string;
}

const MAX_BPS = 10_000;
const GAS_VOLATILITY_BUFFER_BPS = 1_100;

function assertNonEmpty(value: string, field: string): void {
  if (!value || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
}

function parseAtomic(value: string, field: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${field} must be an unsigned integer string`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) {
    throw new Error(`${field} must be greater than zero`);
  }
  return parsed;
}

function parseGweiToWei(gwei: string): bigint {
  const match = gwei.match(/^([0-9]+)(?:\.([0-9]{1,9}))?$/);
  if (!match) {
    throw new Error('gasPriceGwei must be a positive decimal with up to 9 fractional digits');
  }
  const integerPart = match[1];
  if (!integerPart) {
    throw new Error('gasPriceGwei integer part is required');
  }
  const integer = BigInt(integerPart);
  const fractional = BigInt((match[2] ?? '').padEnd(9, '0') || '0');
  const weiPerGwei = 1_000_000_000n;
  const totalWei = integer * weiPerGwei + fractional;
  if (totalWei <= 0n) {
    throw new Error('gasPriceGwei must be greater than zero');
  }
  return totalWei;
}

export function validateQuoteRequest(request: SwapQuoteRequest): void {
  assertNonEmpty(request.fromToken, 'fromToken');
  assertNonEmpty(request.toToken, 'toToken');
  if (request.fromToken.toLowerCase() === request.toToken.toLowerCase()) {
    throw new Error('fromToken and toToken must be different');
  }
  parseAtomic(request.amountInAtomic, 'amountInAtomic');
  if (!Number.isInteger(request.maxSlippageBps) || request.maxSlippageBps <= 0 || request.maxSlippageBps > MAX_BPS) {
    throw new Error('maxSlippageBps must be an integer between 1 and 10000');
  }
  parseGweiToWei(request.gasPriceGwei);
}

export function scoreRoute(request: SwapQuoteRequest, route: RouteCandidate): RankedRoute {
  validateQuoteRequest(request);

  if (!route.simulationOk) {
    throw new Error(`Route ${route.routeId} rejected: simulation failed`);
  }
  if (route.slippageBps > request.maxSlippageBps) {
    throw new Error(`Route ${route.routeId} rejected: slippage exceeds request threshold`);
  }

  const expectedOut = parseAtomic(route.expectedOutAtomic, 'expectedOutAtomic');
  const gasPriceWei = parseGweiToWei(request.gasPriceGwei);
  const bufferedGasPriceWei = (gasPriceWei * BigInt(MAX_BPS + GAS_VOLATILITY_BUFFER_BPS)) / BigInt(MAX_BPS);
  const gasCostAtomic = route.gasUnits * bufferedGasPriceWei;

  const outputScore = Number(expectedOut / 1_000_000n);
  const gasPenalty = Number(gasCostAtomic / 1_000_000_000_000_000n);
  const latencyPenalty = route.estimatedLatencyMs * 0.1;
  const slippagePenalty = route.slippageBps * 10;

  return {
    ...route,
    score: outputScore - gasPenalty - latencyPenalty - slippagePenalty,
    gasCostAtomic: gasCostAtomic.toString()
  };
}

export function selectBestRoute(request: SwapQuoteRequest, candidates: RouteCandidate[]): RankedRoute {
  if (candidates.length === 0) {
    throw new Error('At least one candidate route is required');
  }

  const ranked: RankedRoute[] = [];
  for (const candidate of candidates) {
    try {
      ranked.push(scoreRoute(request, candidate));
    } catch {
      // ignored by design: disqualified routes should not be considered
    }
  }

  if (ranked.length === 0) {
    throw new Error('All routes were disqualified by simulation/slippage/validation');
  }

  ranked.sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  if (!winner) {
    throw new Error('No valid route selected');
  }
  return winner;
}
