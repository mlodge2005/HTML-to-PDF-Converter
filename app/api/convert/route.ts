import { NextResponse } from "next/server";
import { convertHtmlToPdf } from "@/lib/pdf/convertHtmlToPdf";
import { sendPdfEmail } from "@/lib/email/sendPdfEmail";
import { sanitizeHtml } from "@/lib/html/sanitizeHtml";
import {
  logConversionCompleted,
  logConversionFailed,
  logConversionStarted,
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

  const parsed = safeParseConvertFields({
    email,
    filename: file.name,
    fileSizeBytes: file.size,
  });
  if (!parsed.success) {
    return VAL_ERROR(firstValidationError(parsed.fieldErrors));
  }

  const { email: cleanEmail, filename, fileSizeBytes } = parsed.data;

  let html: string;
  try {
    html = await file.text();
  } catch (e) {
    console.error("Failed to read upload:", e);
    return VAL_ERROR("We could not read the uploaded file.");
  }

  const sanitized = sanitizeHtml(html);

  let logId: string | null = null;
  try {
    logId = await logConversionStarted({
      email: cleanEmail,
      originalFilename: filename,
      fileSizeBytes,
    });
  } catch (e) {
    console.error("logConversionStarted (unexpected):", e);
  }

  try {
    const pdf = await convertHtmlToPdf(sanitized);
    await sendPdfEmail({
      to: cleanEmail,
      pdfBuffer: pdf,
      originalFilename: filename,
    });
    await logConversionCompleted(logId);
    return OK_JSON("PDF converted and emailed successfully.");
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("POST /api/convert failed:", e);
    try {
      await logConversionFailed(logId, message);
    } catch (dbE) {
      console.error("logConversionFailed (unexpected):", dbE);
    }
    return ERR_500();
  }
}
