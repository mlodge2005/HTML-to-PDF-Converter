import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { NextResponse } from "next/server";
import { convertHtmlToPdf } from "@/lib/pdf/convertHtmlToPdf";
import { sendPdfEmail, resolvePdfFilename } from "@/lib/email/sendPdfEmail";
import { sanitizeHtml } from "@/lib/html/sanitizeHtml";
import {
  createConversionRun,
  markConversionCompleted,
  markConversionFailed,
} from "@/lib/db";
import { safeParseConvertFields } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VAL_ERROR = (message: string) =>
  NextResponse.json({ ok: false, error: message } as const, { status: 400 });

const OK_JSON = (message: string) =>
  NextResponse.json({ ok: true, message } as const, { status: 200 });

const ERR_500 = () =>
  NextResponse.json(
    { ok: false, error: "Conversion failed. Please try again." } as const,
    { status: 500 }
  );

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

function getErrCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) {
    return String((e as { code: unknown }).code);
  }
  return undefined;
}

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    console.error("Invalid multipart body");
    return VAL_ERROR("Invalid request body.");
  }

  const email = formData.get("email");
  const file = formData.get("file");

  if (typeof email !== "string" || !email.trim()) {
    return VAL_ERROR("A valid email address is required.");
  }
  if (!file || !(file instanceof File)) {
    return VAL_ERROR("Please upload an HTML file.");
  }

  if (
    !process.env.ZOHO_SMTP_USER?.trim() ||
    !process.env.ZOHO_SMTP_APP_PASSWORD ||
    !process.env.FROM_EMAIL?.trim()
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

  const parsed = safeParseConvertFields({
    email,
    filename: file.name,
    fileSizeBytes: file.size,
  });
  if (!parsed.success) {
    return VAL_ERROR(firstValidationError(parsed.fieldErrors));
  }

  const { email: cleanEmail, filename, fileSizeBytes } = parsed.data;

  let ab: ArrayBuffer;
  try {
    ab = await file.arrayBuffer();
  } catch (e) {
    console.error("Failed to read upload:", e);
    return VAL_ERROR("We could not read the uploaded file.");
  }
  const buf = Buffer.from(ab);
  const originalFileSha256 = createHash("sha256").update(buf).digest("hex");
  const html = buf.toString("utf8");
  const ext = fileExtensionFromName(filename);
  const outputFilename = resolvePdfFilename(filename);

  const hasDb = Boolean(process.env.DATABASE_URL?.trim());
  let runId: string | null = null;
  if (hasDb) {
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
    const t0 = performance.now();
    const pdf = await convertHtmlToPdf(sanitized);
    const t1 = performance.now();
    const renderDurationMs = Math.round(t1 - t0);

    const t2 = performance.now();
    await sendPdfEmail({
      to: cleanEmail,
      pdfBuffer: pdf,
      originalFilename: filename,
    });
    const t3 = performance.now();
    const emailDurationMs = Math.round(t3 - t2);
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

    return OK_JSON("PDF converted and emailed successfully.");
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("POST /api/convert failed:", e);
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
