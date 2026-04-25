create extension if not exists "pgcrypto";

create table if not exists html_pdf_conversions (
  id uuid primary key default gen_random_uuid(),

  recipient_email text not null,

  original_filename text,
  original_file_extension text,
  original_file_size_bytes integer,
  original_file_sha256 text,

  output_filename text,
  output_file_size_bytes integer,

  status text not null check (status in ('started', 'completed', 'failed')),

  error_message text,
  error_code text,

  conversion_started_at timestamptz default now(),
  conversion_completed_at timestamptz,
  email_sent_at timestamptz,

  render_duration_ms integer,
  email_duration_ms integer,
  total_duration_ms integer,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_html_pdf_conversions_created_at
  on html_pdf_conversions(created_at desc);

create index if not exists idx_html_pdf_conversions_status
  on html_pdf_conversions(status);

create index if not exists idx_html_pdf_conversions_recipient_email
  on html_pdf_conversions(recipient_email);
