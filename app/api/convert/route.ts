import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextResponse } from "next/server";
import { convertHtmlToPdf, PdfWorkerError } from "@/lib/pdf/convertHtmlToPdf";
import {
  detectRequestMode,
  normalizeJsonPayload,
  normalizeMultipartFormData,
} from "@/lib/convert/normalizeConvertInput";
import { sendPdfEmail, resolvePdfFilename } from "@/lib/email/sendPdfEmail";
import { inlineHtmlAssetsFromZip } from "@/lib/convert/resolveHtmlAssets";
import { sanitizeHtml } from "@/lib/html/sanitizeHtml";
import {
  createConversionRun,
  markConversionCompleted,
  markConversionFailed,
} from "@/lib/db";
import { MAX_FILE_BYTES, convertEmailFieldSchema, safeParseConvertFields } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const VAL_ERROR = (message: string) =>
  NextResponse.json({ ok: false, error: message } as const, { status: 400 });

const OK_JSON = (message: string) =>
  NextResponse.json({ ok: true, message } as const, { status: 200 });

const ERR_500 = () =>
  NextResponse.json(
    { ok: false, error: "Conversion failed. Please try again." } as const,
    { status: 500 }
  );

const MAX_ASSET_ZIP_BYTES = 10 * 1024 * 1024;

function firstValidationError(
  fe: Record<string, string[] | undefined> | undefined
): string {
  if (!fe) return "Please check your input and try again.";
  const v = Object.values(fe)
    .flat()
    .find((s) => s?.length);
  return v || "Please check your input and try again.";
}

function fileExtensionFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".html")) {
    return ".html";
  }
  if (n.endsWith(".htm")) {
    return ".htm";
  }
  return "";
}

function hasHtmlExt(name: string): boolean {
  const n = name.toLowerCase();
  return n.endsWith(".html") || n.endsWith(".htm");
}

function hasZipExt(name: string): boolean {
  return name.toLowerCase().endsWith(".zip");
}

function getErrCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) {
    return String((e as { code: unknown }).code);
  }
  return undefined;
}

function workerFailedResponse(err: unknown) {
  if (err instanceof PdfWorkerError) {
    return NextResponse.json(
      {
        error: "PDF worker failed",
        status: err.status ?? 502,
        details: err.details ?? err.message,
      },
      { status: 502 }
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json(
    {
      error: "PDF worker failed",
      status: 502,
      details: message,
    },
    { status: 502 }
  );
}

async function handleJsonConvert(request: Request, contentType: string) {
  let payload: Record<string, unknown>;
  try {
    const body = await request.json();
    payload =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch (e) {
    console.error("api/convert invalid JSON body", e);
    return NextResponse.json(
      {
        error: "Malformed JSON",
        expected: "Valid JSON body with html/content",
      },
      { status: 400 }
    );
  }

  const normalized = normalizeJsonPayload(payload);
  const workerConfigured = Boolean(
    process.env.PDF_WORKER_URL?.trim() && process.env.PDF_WORKER_TOKEN?.trim()
  );

  console.info("api/convert request", {
    mode: "json",
    contentType,
    normalizedInputType: normalized.ok ? normalized.normalizedInputType : "none",
    htmlLength: normalized.ok ? normalized.htmlLength : 0,
    workerConfigured,
    workerAttempted: false,
    bodyKeys: normalized.ok ? normalized.bodyKeys : normalized.receivedKeys,
  });

  if (!normalized.ok) {
    return NextResponse.json(
      {
        error: normalized.error,
        expected: "Provide html/content or url",
        details: normalized.details,
        receivedKeys: normalized.receivedKeys,
      },
      { status: normalized.status }
    );
  }
  const sanitized = sanitizeHtml(normalized.html);

  try {
    console.info("api/convert worker attempt", {
      mode: "json",
      contentType,
      normalizedInputType: normalized.normalizedInputType,
      htmlLength: sanitized.length,
      workerConfigured,
      workerAttempted: true,
    });
    const pdf = await convertHtmlToPdf({ html: sanitized, runId: normalized.runId });
    console.info("api/convert worker status", {
      mode: "json",
      status: 200,
      pdfBytes: pdf.length,
    });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
      },
    });
  } catch (e) {
    const workerStatus = e instanceof PdfWorkerError ? e.status : undefined;
    console.error("api/convert worker status", {
      status: workerStatus ?? 502,
      error: e instanceof Error ? e.message : String(e),
    });
    return workerFailedResponse(e);
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const mode = detectRequestMode(contentType);
  const workerConfigured = Boolean(
    process.env.PDF_WORKER_URL?.trim() && process.env.PDF_WORKER_TOKEN?.trim()
  );

  if (mode === "json") {
    return handleJsonConvert(request, contentType);
  }

  if (mode === "unsupported") {
    console.info("api/convert request", {
      mode: "unsupported_content_type",
      contentType,
      normalizedInputType: "none",
      htmlLength: 0,
      workerConfigured,
      workerAttempted: false,
      bodyKeys: [],
    });
    return NextResponse.json(
      {
        error: "Unsupported content-type",
        expected: "multipart/form-data or application/json",
        receivedContentType: contentType || null,
        receivedKeys: [],
      },
      { status: 415 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    console.error("Invalid multipart body");
    return VAL_ERROR("Invalid request body.");
  }

  const email = formData.get("email");
  const htmlFile = formData.get("htmlFile");
  const assetZip = formData.get("assetZip");
  const bodyKeys = Array.from(formData.keys());
  const normalized = await normalizeMultipartFormData(formData);
  console.info("api/convert request", {
    mode: "multipart",
    contentType,
    bodyKeys,
    normalizedInputType: normalized.ok ? normalized.normalizedInputType : "none",
    htmlLength: normalized.ok ? normalized.htmlLength : 0,
    workerConfigured,
    workerAttempted: false,
  });

  if (!htmlFile || !(htmlFile instanceof File)) {
    return VAL_ERROR("Please upload an HTML file.");
  }
  if (!hasHtmlExt(htmlFile.name)) {
    return VAL_ERROR("HTML file must be a .html or .htm file.");
  }
  if (htmlFile.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { ok: false, error: `HTML file must be at most ${MAX_FILE_BYTES / 1024 / 1024}MB.` },
      { status: 413 }
    );
  }
  if (assetZip != null && !(assetZip instanceof File)) {
    return VAL_ERROR("Asset ZIP upload is invalid.");
  }
  if (assetZip instanceof File) {
    if (!hasZipExt(assetZip.name)) {
      return VAL_ERROR("Asset ZIP must be a .zip file.");
    }
    if (assetZip.size > MAX_ASSET_ZIP_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `Asset ZIP must be at most ${MAX_ASSET_ZIP_BYTES / 1024 / 1024}MB.`,
        },
        { status: 413 }
      );
    }
  }
  const emailValue =
    typeof email === "string" && email.trim().length > 0 ? email.trim() : null;
  if (emailValue) {
    const parsedEmail = convertEmailFieldSchema.safeParse(emailValue);
    if (!parsedEmail.success) {
      return VAL_ERROR("A valid email address is required.");
    }
  }

  const shouldEmail = Boolean(emailValue);
  const parsed = safeParseConvertFields({
    email: emailValue ?? process.env.FROM_EMAIL ?? "noreply@example.com",
    filename: htmlFile.name,
    fileSizeBytes: htmlFile.size,
  });
  if (!parsed.success) {
    if (shouldEmail) {
      return VAL_ERROR(firstValidationError(parsed.fieldErrors));
    }
  }

  const filename = htmlFile.name;
  const fileSizeBytes = htmlFile.size;
  const cleanEmail = emailValue;

  let ab: ArrayBuffer;
  try {
    ab = await htmlFile.arrayBuffer();
  } catch (e) {
    console.error("Failed to read upload:", e);
    return VAL_ERROR("We could not read the uploaded file.");
  }
  if (!normalized.ok) {
    return NextResponse.json(
      {
        error: normalized.error,
        expected: "Provide html/content or url",
        details: normalized.details,
        receivedKeys: normalized.receivedKeys,
      },
      { status: normalized.status }
    );
  }

  const buf = Buffer.from(ab);
  const originalFileSha256 = createHash("sha256").update(buf).digest("hex");
  let html = normalized.html;
  if (assetZip instanceof File) {
    try {
      const zipAb = await assetZip.arrayBuffer();
      const zipBuf = Buffer.from(zipAb);
      const resolved = await inlineHtmlAssetsFromZip({
        html,
        zipBuffer: zipBuf,
      });
      if (resolved.missingPaths.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Missing asset files",
            details:
              "Some relative asset paths referenced by HTML were not found in the ZIP.",
            missingPaths: resolved.missingPaths,
          },
          { status: 400 }
        );
      }
      html = resolved.html;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid asset ZIP",
          details: message,
        },
        { status: 400 }
      );
    }
  }
  const ext = fileExtensionFromName(filename);
  const outputFilename = resolvePdfFilename(filename);

  const hasDb = Boolean(process.env.DATABASE_URL?.trim());
  let runId: string | null = null;
  if (hasDb && cleanEmail) {
    try {
      runId = await createConversionRun({
        recipientEmail: cleanEmail,
        originalFilename: filename,
        originalFileExtension: ext,
        originalFileSizeBytes: fileSizeBytes,
        originalFileSha256,
        outputFilename,
      });
    } catch (e) {
      console.error("createConversionRun failed:", e);
    }
  }

  const sanitized = sanitizeHtml(html);

  const tPipeline0 = performance.now();
  try {
    if (
      !process.env.PDF_WORKER_URL?.trim() ||
      !process.env.PDF_WORKER_TOKEN?.trim()
    ) {
      console.error("PDF_WORKER_URL or PDF_WORKER_TOKEN is not configured.");
      return ERR_500();
    }
    if (
      shouldEmail &&
      (!process.env.ZOHO_SMTP_USER?.trim() ||
        !process.env.ZOHO_SMTP_APP_PASSWORD ||
        !process.env.FROM_EMAIL?.trim())
    ) {
      console.error("Zoho SMTP or FROM_EMAIL is not configured.");
      return ERR_500();
    }
    if (!process.env.ZOHO_SMTP_HOST) {
      process.env.ZOHO_SMTP_HOST = "smtp.zoho.com";
    }
    if (!process.env.ZOHO_SMTP_PORT) {
      process.env.ZOHO_SMTP_PORT = "465";
    }

    const t0 = performance.now();
    console.info("api/convert worker attempt", {
      mode: "multipart",
      contentType,
      normalizedInputType: "file",
      htmlLength: sanitized.length,
      workerConfigured,
      workerAttempted: true,
    });
    const pdf = await convertHtmlToPdf({
      html: sanitized,
      runId: runId ?? undefined,
    });
    console.info("api/convert worker status", { status: 200, pdfBytes: pdf.length });
    const t1 = performance.now();
    const renderDurationMs = Math.round(t1 - t0);

    const t2 = performance.now();
    let emailDurationMs = 0;
    if (cleanEmail) {
      await sendPdfEmail({
        to: cleanEmail,
        pdfBuffer: pdf,
        originalFilename: filename,
      });
      const t3 = performance.now();
      emailDurationMs = Math.round(t3 - t2);
    }
    const t3 = performance.now();
    const totalDurationMs = Math.round(t3 - tPipeline0);

    if (runId) {
      try {
        await markConversionCompleted({
          id: runId,
          outputFileSizeBytes: pdf.length,
          renderDurationMs,
          emailDurationMs,
          totalDurationMs,
        });
      } catch (e) {
        console.error("markConversionCompleted failed:", e);
      }
    }

    if (cleanEmail) {
      return OK_JSON("PDF converted and emailed successfully.");
    }
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
      },
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("POST /api/convert failed:", e);
    if (e instanceof PdfWorkerError) {
      console.error("api/convert worker status", {
        status: e.status ?? 502,
        details: e.details ?? e.message,
      });
    }
    if (runId) {
      try {
        await markConversionFailed({
          id: runId,
          errorMessage: err.message,
          errorCode: getErrCode(e),
          totalDurationMs: Math.round(performance.now() - tPipeline0),
        });
      } catch (dbE) {
        console.error("markConversionFailed failed:", dbE);
      }
    }
    return ERR_500();
  }
}
