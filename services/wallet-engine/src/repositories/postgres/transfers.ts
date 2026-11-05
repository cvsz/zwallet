import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type { WalletTransferRecord } from "../../walletEngine.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/zwallet",
});

function toRecord(row: any): WalletTransferRecord {
  const record: WalletTransferRecord = {
    id: String(row.id),
    digest: String(row.digest),
    chain: row.chain,
    from: String(row.from_address),
    to: String(row.to_address),
    amountAtomic: String(row.amount_atomic),
    nonce: Number(row.nonce ?? 0),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };

  if (row.tx_hash) record.txHash = String(row.tx_hash);
  if (row.failure_reason) record.failureReason = String(row.failure_reason);

  return record;
}

export async function createTransferRecord(input: {
  chain: "evm" | "solana" | "bitcoin";
  from: string;
  to: string;
  amountAtomic: string;
  nonce?: number;
}): Promise<WalletTransferRecord> {
  const timestamp = new Date().toISOString();

  const digest = createHash("sha256")
    .update([
      input.chain,
      input.from,
      input.to,
      input.amountAtomic,
      String(input.nonce ?? 0),
      timestamp,
    ].join(":"))
    .digest("hex");

  const result = await pool.query(
    `
    INSERT INTO wallet_transfers (
      id, digest, chain, from_address, to_address,
      amount_atomic, nonce, status, created_at, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
    `,
    [
      randomUUID(),
      digest,
      input.chain,
      input.from,
      input.to,
      input.amountAtomic,
      input.nonce ?? 0,
      "previewed",
      timestamp,
      timestamp,
    ]
  );

  return toRecord(result.rows[0]);
}

export async function getTransferById(id: string): Promise<WalletTransferRecord | undefined> {
  const result = await pool.query(
    `SELECT * FROM wallet_transfers WHERE id = $1 LIMIT 1`,
    [id]
  );

  return result.rows[0] ? toRecord(result.rows[0]) : undefined;
}

export async function listTransfers(): Promise<WalletTransferRecord[]> {
  const result = await pool.query(
    `SELECT * FROM wallet_transfers ORDER BY created_at DESC LIMIT 100`
  );

  return result.rows.map(toRecord);
}

export async function updateTransferStatus(
  id: string,
  status: WalletTransferRecord["status"],
  options: { txHash?: string; failureReason?: string } = {}
): Promise<WalletTransferRecord> {
  if (status === "confirmed") {
    throw new Error(
      "Transfer confirmation requires independently verified chain finality; generic status updates cannot settle funds"
    );
  }

  const result = await pool.query(
    `
    UPDATE wallet_transfers
    SET
      status = $2,
      tx_hash = COALESCE($3, tx_hash),
      failure_reason = COALESCE($4, failure_reason),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
    `,
    [id, status, options.txHash ?? null, options.failureReason ?? null]
  );

  if (!result.rows[0]) throw new Error(`transfer not found: ${id}`);

  return toRecord(result.rows[0]);
}
