import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) {
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

/**
 * Returns the new row id, or `null` when `DATABASE_URL` is unset.
 */
export async function logConversionStarted(args: {
  email: string;
  originalFilename?: string;
  fileSizeBytes: number;
}): Promise<string | null> {
  const p = getPool();
  if (!p) {
    return null;
  }

  try {
    const res = await p.query<{ id: string }>(
      `insert into html_pdf_conversions
        (email, original_filename, file_size_bytes, status)
       values ($1, $2, $3, 'started')
       returning id`,
      [args.email, args.originalFilename ?? null, args.fileSizeBytes]
    );
    return res.rows[0]?.id ?? null;
  } catch (e) {
    console.error("logConversionStarted failed:", e);
    return null;
  }
}

export async function logConversionCompleted(id: string | null): Promise<void> {
  if (!id) return;
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `update html_pdf_conversions
       set status = 'completed', completed_at = now()
       where id = $1::uuid`,
      [id]
    );
  } catch (e) {
    console.error("logConversionCompleted failed:", e);
  }
}

export async function logConversionFailed(
  id: string | null,
  errorMessage: string
): Promise<void> {
  if (!id) return;
  const p = getPool();
  if (!p) return;
  const truncated = errorMessage.slice(0, 8_000);
  try {
    await p.query(
      `update html_pdf_conversions
       set status = 'failed', error_message = $2, completed_at = now()
       where id = $1::uuid`,
      [id, truncated]
    );
  } catch (e) {
    console.error("logConversionFailed failed:", e);
  }
}
