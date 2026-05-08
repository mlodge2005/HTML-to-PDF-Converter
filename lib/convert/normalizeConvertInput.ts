import { MAX_FILE_BYTES } from "@/lib/validation";

export type RequestMode = "json" | "multipart" | "unsupported";
export type NormalizedInputType = "html" | "content" | "file" | "none";

type NormalizeOk = {
  ok: true;
  html: string;
  htmlLength: number;
  htmlBytes: number;
  normalizedInputType: Exclude<NormalizedInputType, "none">;
  runId?: string;
  bodyKeys: string[];
};

type NormalizeError = {
  ok: false;
  status: 400 | 413;
  error: string;
  expected?: string;
  details?: string;
  receivedKeys: string[];
};

export type NormalizeResult = NormalizeOk | NormalizeError;

export function detectRequestMode(contentType: string): RequestMode {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("application/json")) {
    return "json";
  }
  if (normalized.includes("multipart/form-data")) {
    return "multipart";
  }
  return "unsupported";
}

function buildHtmlResult(args: {
  htmlRaw: string;
  normalizedInputType: Exclude<NormalizedInputType, "none">;
  runId?: string;
  bodyKeys: string[];
}): NormalizeResult {
  const html = args.htmlRaw.trim();
  if (!html) {
    return {
      ok: false,
      status: 400,
      error: "Missing input",
      expected: "Provide html/content or url",
      receivedKeys: args.bodyKeys,
    };
  }
  const htmlBytes = Buffer.byteLength(html, "utf8");
  if (htmlBytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      error: "Input too large",
      details: `Maximum allowed size is ${MAX_FILE_BYTES} bytes`,
      receivedKeys: args.bodyKeys,
    };
  }
  return {
    ok: true,
    html,
    htmlLength: html.length,
    htmlBytes,
    normalizedInputType: args.normalizedInputType,
    runId: args.runId,
    bodyKeys: args.bodyKeys,
  };
}

export function normalizeJsonPayload(
  payload: Record<string, unknown>
): NormalizeResult {
  const bodyKeys = Object.keys(payload);
  const htmlRaw = typeof payload.html === "string" ? payload.html : undefined;
  // Compatibility normalization: support legacy `content` key.
  const contentRaw =
    typeof payload.content === "string" ? payload.content : undefined;
  const urlRaw = typeof payload.url === "string" ? payload.url.trim() : "";
  const runId = typeof payload.runId === "string" ? payload.runId : undefined;

  const normalizedInputType = htmlRaw
    ? "html"
    : contentRaw
      ? "content"
      : "none";
  const raw = htmlRaw ?? contentRaw ?? "";

  if (!raw.trim() && !urlRaw) {
    return {
      ok: false,
      status: 400,
      error: "Missing input",
      expected: "Provide html/content or url",
      receivedKeys: bodyKeys,
    };
  }
  if (!raw.trim() && urlRaw) {
    return {
      ok: false,
      status: 400,
      error: "Missing input",
      expected: "Provide html/content or url",
      details: "URL-only conversion is not supported by the current worker contract.",
      receivedKeys: bodyKeys,
    };
  }
  if (normalizedInputType === "none") {
    return {
      ok: false,
      status: 400,
      error: "Missing input",
      expected: "Provide html/content or url",
      receivedKeys: bodyKeys,
    };
  }
  return buildHtmlResult({
    htmlRaw: raw,
    normalizedInputType,
    runId,
    bodyKeys,
  });
}

export async function normalizeMultipartFormData(
  formData: FormData
): Promise<NormalizeResult> {
  const bodyKeys = Array.from(formData.keys());
  const file = formData.get("htmlFile");
  if (!file || !(file instanceof File)) {
    return {
      ok: false,
      status: 400,
      error: "Please upload an HTML file.",
      receivedKeys: bodyKeys,
    };
  }
  const fileText = await file.text().catch(() => "");
  return buildHtmlResult({
    htmlRaw: fileText,
    normalizedInputType: "file",
    bodyKeys,
  });
}
