const WORKER_FETCH_MS = 55_000;

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
    throw new Error("PDF_WORKER_URL is not configured.");
  }
  if (!token) {
    throw new Error("PDF_WORKER_TOKEN is not configured.");
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
      throw new Error(
        `PDF worker HTTP ${res.status}${snippet ? `: ${snippet}` : ""}`
      );
    }

    const ct = res.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/pdf")) {
      throw new Error(`PDF worker returned unexpected Content-Type: ${ct}`);
    }

    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("PDF worker request timed out.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
