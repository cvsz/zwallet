const DEFAULT_EVM_RPC_URL = "https://ethereum-rpc.publicnode.com";

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

function validateRpcUrl(value: string): URL {
  const url = new URL(value);
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.username || url.password || url.hash) {
    throw new Error("EVM_RPC_URL must not contain credentials or fragments");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("EVM_RPC_URL must use HTTPS except for loopback development endpoints");
  }
  return url;
}

function parseHexQuantity(value: string, field: string): bigint {
  if (!/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error(`invalid EVM RPC ${field} quantity`);
  }
  return BigInt(value);
}

class EvmJsonRpcProvider {
  private readonly endpoint: URL;
  private requestId = 0;

  constructor(endpoint: string) {
    this.endpoint = validateRpcUrl(endpoint);
  }

  private async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++this.requestId,
        method,
        params,
      }),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      throw new Error(`EVM RPC HTTP ${response.status}`);
    }

    const payload = (await response.json()) as JsonRpcResponse<T>;
    if (payload.error) {
      throw new Error(`EVM RPC ${payload.error.code}: ${payload.error.message}`);
    }
    if (payload.result === undefined) {
      throw new Error(`EVM RPC ${method} returned no result`);
    }
    return payload.result;
  }

  async getBlockNumber(): Promise<number> {
    const raw = await this.call<string>("eth_blockNumber");
    const value = parseHexQuantity(raw, "blockNumber");
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("EVM block number exceeds safe integer range");
    }
    return Number(value);
  }

  async getFeeData(): Promise<{
    gasPrice: bigint;
    maxFeePerGas: bigint | null;
    maxPriorityFeePerGas: bigint | null;
  }> {
    const gasPriceRaw = await this.call<string>("eth_gasPrice");
    const gasPrice = parseHexQuantity(gasPriceRaw, "gasPrice");

    let maxPriorityFeePerGas: bigint | null = null;
    try {
      const priorityRaw = await this.call<string>("eth_maxPriorityFeePerGas");
      maxPriorityFeePerGas = parseHexQuantity(priorityRaw, "maxPriorityFeePerGas");
    } catch {
      // Some compatible chains do not implement EIP-1559 priority-fee RPC.
      // Preserve legacy behavior by returning a null optional field while the
      // mandatory gas price remains independently verified above.
    }

    const maxFeePerGas = maxPriorityFeePerGas === null ? null : gasPrice * 2n + maxPriorityFeePerGas;
    return { gasPrice, maxFeePerGas, maxPriorityFeePerGas };
  }
}

export const evmProvider = new EvmJsonRpcProvider(process.env.EVM_RPC_URL ?? DEFAULT_EVM_RPC_URL);
