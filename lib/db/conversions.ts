import { assertRowCount, getDbPool } from "./pool";

export type ConversionStatus = "started" | "completed" | "failed";

export type ConversionRunRow = {
  id: string;
  recipient_email: string;
  original_filename: string | null;
  original_file_extension: string | null;
  original_file_size_bytes: number | null;
  original_file_sha256: string | null;
  output_filename: string | null;
  output_file_size_bytes: number | null;
  status: ConversionStatus;
  error_message: string | null;
  error_code: string | null;
  conversion_started_at: string;
  conversion_completed_at: string | null;
  email_sent_at: string | null;
  render_duration_ms: number | null;
  email_duration_ms: number | null;
  total_duration_ms: number | null;
  created_at: string;
  updated_at: string;
};

export async function createConversionRun(args: {
  recipientEmail: string;
  originalFilename: string;
  originalFileExtension: string;
  originalFileSizeBytes: number;
  originalFileSha256: string;
  outputFilename: string;
}): Promise<string> {
  const pool = getDbPool();
  const res = await pool.query<{ id: string }>(
    `insert into html_pdf_conversions (
      recipient_email,
      original_filename,
      original_file_extension,
      original_file_size_bytes,
      original_file_sha256,
      output_filename,
      status
    ) values ($1, $2, $3, $4, $5, $6, 'started')
    returning id`,
    [
      args.recipientEmail,
      args.originalFilename,
      args.originalFileExtension,
      args.originalFileSizeBytes,
      args.originalFileSha256,
      args.outputFilename,
    ]
  );
  assertRowCount(res, "createConversionRun insert", 1);
  const id = res.rows[0]?.id;
  if (!id) {
    throw new Error("createConversionRun: no id returned.");
  }
  return id;
}

export async function markConversionCompleted(args: {
  id: string;
  outputFileSizeBytes: number;
  renderDurationMs: number;
  emailDurationMs: number;
  totalDurationMs: number;
}): Promise<void> {
  const pool = getDbPool();
  const res = await pool.query(
    `update html_pdf_conversions
     set
       status = 'completed',
       output_file_size_bytes = $2,
       conversion_completed_at = now(),
       email_sent_at = now(),
       render_duration_ms = $3,
       email_duration_ms = $4,
       total_duration_ms = $5,
       updated_at = now()
     where id = $1::uuid`,
    [
      args.id,
      args.outputFileSizeBytes,
      args.renderDurationMs,
      args.emailDurationMs,
      args.totalDurationMs,
    ]
  );
  assertRowCount(res, "markConversionCompleted", 1);
}

export async function markConversionFailed(args: {
  id: string;
  errorMessage: string;
  errorCode?: string;
  totalDurationMs?: number;
}): Promise<void> {
  const pool = getDbPool();
  const message = args.errorMessage.slice(0, 8_000);
  const res = await pool.query(
    `update html_pdf_conversions
     set
       status = 'failed',
       error_message = $2,
       error_code = $3,
       total_duration_ms = coalesce($4, total_duration_ms),
       updated_at = now()
     where id = $1::uuid`,
    [
      args.id,
      message,
      args.errorCode ?? null,
      args.totalDurationMs ?? null,
    ]
  );
  assertRowCount(res, "markConversionFailed", 1);
}

// Intentionally loose: pipeline script inspects many columns
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getConversionRunById(id: string): Promise<any> {
  const pool = getDbPool();
  const res = await pool.query(
    `select * from html_pdf_conversions where id = $1::uuid`,
    [id]
  );
  if ((res.rowCount ?? 0) < 1 || !res.rows[0]) {
    throw new Error(`getConversionRunById: no row for id ${id}.`);
  }
  return res.rows[0];
}
