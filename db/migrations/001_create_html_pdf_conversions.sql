-- Run against your Neon (or any Postgres) database, e.g. with psql or Neon console.

CREATE TABLE IF NOT EXISTS html_pdf_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  original_filename text,
  file_size_bytes integer,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_html_pdf_conversions_created_at
  ON html_pdf_conversions (created_at DESC);
