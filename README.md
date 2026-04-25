# HTML to PDF

Next.js app on **Vercel** (or any host): upload HTML, validate, log to Postgres, call a **private VPS worker** for PDF generation, then email via Zoho SMTP. **Playwright runs only on the VPS**, not in the serverless bundle.

## Architecture

| Piece | Role |
| ----- | ---- |
| Next.js app | UI, `/api/convert`, sanitization, DB, Zoho email |
| `worker-pdf/` (VPS) | Express + Playwright Chromium, `POST /convert` |

Environment on the app:

- `PDF_WORKER_URL` — full URL to the worker endpoint, e.g. `https://pdf.example.com/convert`
- `PDF_WORKER_TOKEN` — same secret as the worker’s `PDF_WORKER_TOKEN`

See `worker-pdf/README.md` for VPS install, systemd, and curl examples.

## Vercel app

1. Set all variables from `.env.example` in the Vercel project (including `PDF_WORKER_URL`, `PDF_WORKER_TOKEN`, `DATABASE_URL`, Zoho, `FROM_EMAIL`).
2. Deploy; **do not** install Playwright on Vercel — it is not a dependency of this app.
3. Ensure the worker URL is reachable from Vercel (HTTPS, valid TLS cert recommended).

## VPS worker

1. Copy `worker-pdf/` to the server (e.g. `/opt/html-pdf-worker`, matching `worker-pdf/systemd/html-pdf-worker.service`).
2. Follow `worker-pdf/README.md`: `npm install`, `npx playwright install --with-deps chromium`, `npm run build`, `npm start`.
3. Install the systemd unit from `worker-pdf/systemd/html-pdf-worker.service` (adjust paths if needed).
4. Put nginx/Caddy in front with TLS; restrict access (IP allowlist, VPN, or mutual TLS) where possible.

### systemd (summary)

```bash
sudo cp worker-pdf/systemd/html-pdf-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now html-pdf-worker
```

### curl: worker health (on VPS)

```bash
curl -sS http://127.0.0.1:8787/health
```

### curl: worker convert (on VPS)

```bash
curl -sS -X POST http://127.0.0.1:8787/convert \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"html":"<html><body><h1>Hi</h1></body></html>","runId":"test-1"}' \
  -o /tmp/test.pdf
```

### End-to-end (app + worker + email + DB)

From the **monorepo root** (with worker running and env set):

```bash
npm run test:pipeline
```

Requires `PDF_WORKER_URL`, `PDF_WORKER_TOKEN`, DB, Zoho, and `sample_landscaping_contract.html`.

## Local app setup

1. `npm install`
2. Copy `.env.example` → `.env.local` (include worker URL pointing at your VPS or `http://127.0.0.1:8787/convert` for local worker).
3. `npm run dev`

## Database

```bash
npm run db:migrate
```

## Scripts

| Command | Action |
| ------- | ------ |
| `npm run dev` | Next dev server |
| `npm run build` | Next production build |
| `npm run start` | Next production start |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Run SQL migrations |
| `npm run test:pipeline` | Full pipeline test |

## Stack

Next.js (App Router), TypeScript, Tailwind, remote PDF worker (Playwright on VPS), Nodemailer, Zod, `pg`.
