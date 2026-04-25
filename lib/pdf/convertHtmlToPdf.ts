import { chromium, type Route } from "playwright";

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

/**
 * Disallows scripts, dynamic fetches, and public URLs. Data/blob assets are allowed; the
 * main document is only `about:blank` (how `setContent` loads).
 */
function shouldBlockRequest(url: string, type: string): boolean {
  if (["script", "xhr", "fetch", "websocket", "eventsource", "ping", "texttrack", "manifest", "cspreport"].includes(type)) {
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

/**
 * Renders pre-sanitized HTML in Chromium and returns a PDF buffer.
 */
export async function convertHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route("**/*", installRequestFilter);
    const page = await context.newPage();

    await page.setContent(html, {
      waitUntil: "load",
      timeout: 45_000,
    });

    return Buffer.from(await page.pdf(PDF_OPTIONS));
  } finally {
    await browser.close();
  }
}
