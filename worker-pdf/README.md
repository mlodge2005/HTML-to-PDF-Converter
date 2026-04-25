# HTML PDF Worker

Standalone **Express + TypeScript + Playwright** service. It is **not** part of the Next.js app: deploy it separately on a VPS, build with `tsc`, and run `node dist/server.js` (or use systemd).

## What it does

- **`GET /health`** — JSON `{ "ok": true, "service": "html-pdf-worker" }` (no auth).
- **`POST /convert`** — Requires `Authorization: Bearer <PDF_WORKER_TOKEN>`. JSON body:
  ```json
  { "html": "string", "runId": "optional string" }
  ```
  Max JSON body **2MB**. Returns **`application/pdf`**. Letter size, print backgrounds, 0.5in margins. Network requests blocked during render. **20s** conversion cap. Logs `runId`, duration, success/failure — **never** full HTML.

## Local install

From this directory (`worker-pdf/`):

```bash
npm install
npx playwright install chromium
```

On Linux (recommended for production), install browser **and** OS deps:

```bash
npx playwright install --with-deps chromium
```

Create `.env`:

```bash
cp .env.example .env
# Set PDF_WORKER_TOKEN to a long random secret
# Optional: PORT=8787
```

Run in dev (TypeScript via tsx):

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## VPS install

1. Copy the `worker-pdf` folder to the server, e.g. **`/opt/html-pdf-worker`** (must match systemd `WorkingDirectory`).
2. Install Node.js 20+ on the VPS.
3. On the server:

   ```bash
   cd /opt/html-pdf-worker
   npm install
   npx playwright install --with-deps chromium
   cp .env.example .env
   # edit .env: PDF_WORKER_TOKEN, PORT if needed
   npm run build
   ```

4. Smoke test:

   ```bash
   npm start
   ```

## Playwright install command

```bash
npx playwright install --with-deps chromium
```

Use `npx playwright install chromium` on macOS/Windows dev machines if you skip system deps.

## systemd setup

1. Ensure the app lives at **`/opt/html-pdf-worker`** and `.env` exists there.
2. Install the unit file:

   ```bash
   sudo cp systemd/html-pdf-worker.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable html-pdf-worker
   sudo systemctl start html-pdf-worker
   sudo systemctl status html-pdf-worker
   ```

3. Logs:

   ```bash
   journalctl -u html-pdf-worker -f
   ```

Adjust `WorkingDirectory` / `EnvironmentFile` in the unit file if you use another path.

## curl: health test

```bash
curl -sS http://127.0.0.1:8787/health
```

Expected: `{"ok":true,"service":"html-pdf-worker"}`

## curl: convert test

Replace `YOUR_TOKEN` with `PDF_WORKER_TOKEN` from `.env`:

```bash
curl -sS -X POST http://127.0.0.1:8787/convert \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"html":"<html><body><h1>Hello</h1></body></html>","runId":"curl-test-1"}' \
  -o /tmp/worker-test.pdf
```

Missing or wrong bearer token → **401** and JSON error.

## Security

- Put **TLS** (nginx, Caddy, etc.) in front on the public hostname.
- Restrict who can reach the worker (firewall / VPN / IP allowlist).
- Keep `PDF_WORKER_TOKEN` long and random; rotate if leaked.
