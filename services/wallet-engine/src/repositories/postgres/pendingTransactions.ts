import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/zwallet",
});

export async function createPendingTransaction(
  input: {
    transferId: string;
    txHash: string;
    chain: string;
    nonce: number;
  }
) {
  await pool.query(
    `
    INSERT INTO wallet_pending_transactions (
      transfer_id,
      tx_hash,
      chain,
      nonce,
      status
    )
    VALUES ($1,$2,$3,$4,$5)
    `,
    [
      input.transferId,
      input.txHash,
      input.chain,
      input.nonce,
      "pending",
    ]
  );
}

export async function markPendingConfirmed(
  _transferId: string
): Promise<never> {
  throw new Error(
    "Pending transaction confirmation is disabled until a chain-specific finality verifier supplies canonical receipt evidence"
  );
}
