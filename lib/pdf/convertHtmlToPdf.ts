const WORKER_FETCH_MS = 55_000;

export class PdfWorkerError extends Error {
  status?: number;
  details?: string;

  constructor(message: string, options?: { status?: number; details?: string }) {
    super(message);
    this.name = "PdfWorkerError";
    this.status = options?.status;
    this.details = options?.details;
  }
}

/**
 * Calls the private VPS Playwright worker. Vercel does not bundle or run Chromium.
 */
export async function convertHtmlToPdf(args: {
  html: string;
  runId?: string;
}): Promise<Buffer> {
  const url = process.env.PDF_WORKER_URL?.trim();
  const token = process.env.PDF_WORKER_TOKEN?.trim();
  if (!url) {
    throw new PdfWorkerError("PDF_WORKER_URL is not configured.");
  }
  if (!token) {
    throw new PdfWorkerError("PDF_WORKER_TOKEN is not configured.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKER_FETCH_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        html: args.html,
        ...(args.runId ? { runId: args.runId } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const snippet = (await res.text().catch(() => "")).slice(0, 400);
      throw new PdfWorkerError("PDF worker failed", {
        status: res.status,
        details: snippet || undefined,
      });
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/pdf")) {
      throw new PdfWorkerError("PDF worker returned unexpected content type", {
        details: ct,
      });
    }

    const ab = await res.arrayBuffer();
    const pdf = Buffer.from(ab);
    if (pdf.length === 0) {
      throw new PdfWorkerError("PDF worker returned an empty PDF response.");
    }
    return pdf;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new PdfWorkerError("PDF worker request timed out.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
