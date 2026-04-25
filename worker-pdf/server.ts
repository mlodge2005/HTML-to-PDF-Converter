import { config as loadEnv } from "dotenv";
loadEnv();

import * as crypto from "node:crypto";
import * as http from "node:http";
import express, { type Request, type Response, type NextFunction } from "express";
import { chromium, type Route } from "playwright";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 20_000;

const PDF_OPTIONS = {
  format: "Letter" as const,
  printBackground: true,
  margin: {
    top: "0.5in",
    right: "0.5in",
    bottom: "0.5in",
    left: "0.5in",
  },
};

function shouldBlockRequest(url: string, type: string): boolean {
  if (
    [
      "script",
      "xhr",
      "fetch",
      "websocket",
      "eventsource",
      "ping",
      "texttrack",
      "manifest",
      "cspreport",
    ].includes(type)
  ) {
    return true;
  }
  if (url === "about:blank") {
    return type !== "document";
  }
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    return false;
  }
  if (
    /^https?:/i.test(url) ||
    url.startsWith("//") ||
    url.startsWith("file:") ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension:")
  ) {
    return true;
  }
  return true;
}

async function installRequestFilter(route: Route): Promise<void> {
  const request = route.request();
  if (shouldBlockRequest(request.url(), request.resourceType())) {
    await route.abort("blockedbyclient");
  } else {
    await route.continue();
  }
}

function verifyBearer(authHeader: string | undefined, expected: string): boolean {
  if (!authHeader?.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.slice(7).trim();
  if (!expected || token.length !== expected.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

function bearerAuth(
  expectedToken: string
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (!verifyBearer(req.headers.authorization, expectedToken)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }
    next();
  };
}

/**
 * Renders HTML to PDF with network blocking; entire operation is capped at 20s.
 * Always closes the browser in `finally`.
 */
async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  const browserRef: { current: Awaited<ReturnType<typeof chromium.launch>> | null } =
    { current: null };
  let timer: NodeJS.Timeout | undefined;

  const run = async (): Promise<Buffer> => {
    browserRef.current = await chromium.launch({ headless: true });
    const context = await browserRef.current.newContext();
    await context.route("**/*", installRequestFilter);
    const page = await context.newPage();
    await page.setContent(html, {
      waitUntil: "load",
      timeout: CONVERSION_TIMEOUT_MS,
    });
    const buf = await page.pdf(PDF_OPTIONS);
    return Buffer.from(buf);
  };

  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Conversion timed out after 20s"));
        }, CONVERSION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (browserRef.current) {
      await browserRef.current.close().catch(() => {});
    }
  }
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "html-pdf-worker" });
});

const token = process.env.PDF_WORKER_TOKEN?.trim();
if (!token) {
  console.error("FATAL: PDF_WORKER_TOKEN is not set.");
  process.exit(1);
}

app.post(
  "/convert",
  bearerAuth(token),
  async (req: Request, res: Response) => {
    const started = Date.now();
    const runId =
      typeof req.body?.runId === "string" ? req.body.runId : undefined;

    const html = req.body?.html;
    if (typeof html !== "string") {
      res
        .status(400)
        .json({ ok: false, error: "Expected JSON body with html: string" });
      return;
    }

    const bytes = Buffer.byteLength(html, "utf8");
    if (bytes > MAX_HTML_BYTES) {
      console.error(
        JSON.stringify({
          event: "convert_rejected",
          runId: runId ?? null,
          reason: "payload_too_large",
          bytes,
        })
      );
      res.status(413).json({ ok: false, error: "HTML exceeds 2MB limit" });
      return;
    }

    try {
      const pdf = await htmlToPdfBuffer(html);
      const ms = Date.now() - started;
      console.log(
        JSON.stringify({
          event: "convert_ok",
          runId: runId ?? null,
          durationMs: ms,
          pdfBytes: pdf.length,
        })
      );
      res.setHeader("Content-Type", "application/pdf");
      res.status(200).send(pdf);
    } catch (err) {
      const ms = Date.now() - started;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        JSON.stringify({
          event: "convert_fail",
          runId: runId ?? null,
          durationMs: ms,
          error: message,
        })
      );
      res.status(500).json({ ok: false, error: "PDF generation failed" });
    }
  }
);

const port = parseInt(process.env.PORT || "8787", 10);
const server = http.createServer(app);
server.listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "listen",
      port,
      service: "html-pdf-worker",
    })
  );
});
