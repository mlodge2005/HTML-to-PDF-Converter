import { Pool, type QueryResult, type QueryResultRow } from "pg";

let _pool: Pool | null = null;

/**
 * Shared pool. Throws if `DATABASE_URL` is missing — call only when DB access is required.
 * Does not connect or validate at module load time.
 */
export function getDbPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) {
    throw new Error("DATABASE_URL is not set or is empty.");
  }
  if (!_pool) {
    _pool = new Pool({
      connectionString: url,
      max: 10,
      connectionTimeoutMillis: 15_000,
    });
  }
  return _pool;
}

export function assertRowCount(
  res: QueryResult<QueryResultRow>,
  op: string,
  expected: number
): void {
  const n = res.rowCount ?? 0;
  if (n !== expected) {
    throw new Error(
      `Database ${op}: expected ${expected} row(s) affected, got ${n}.`
    );
  }
}

export async function testDbConnection(): Promise<void> {
  const pool = getDbPool();
  const c = await pool.connect();
  try {
    await c.query("select 1");
  } finally {
    c.release();
  }
}
