/**
 * End-to-end smoke test: DB, PDF render, email, row updates.
 * Run migrations first: npm run db:migrate
 * From project root: npm run test:pipeline
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { performance } from "node:perf_hooks";
import { convertHtmlToPdf } from "../lib/pdf/convertHtmlToPdf";
import { sendPdfEmail } from "../lib/email/sendPdfEmail";
import { sanitizeHtml } from "../lib/html/sanitizeHtml";
import {
  createConversionRun,
  getConversionRunById,
  markConversionCompleted,
  markConversionFailed,
  testDbConnection,
} from "../lib/db/index";

const SAMPLE_NAME = "sample_landscaping_contract.html";
const root = process.cwd();
config({ path: join(root, ".env") });
config({ path: join(root, ".env.local"), override: true });

function need(name: string, v: string | undefined): string {
  const t = v?.trim();
  if (!t) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return t;
}

function assert(cond: boolean, message: string): void {
  if (!cond) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function getErrCode(e: unknown): string | undefined {
  if (e && typeof e === "object" && "code" in e) {
    return String((e as { code: unknown }).code);
  }
  return undefined;
}

function isSmtp535(e: unknown): boolean {
  if (e && typeof e === "object" && "responseCode" in e) {
    return (e as { responseCode: unknown }).responseCode === 535;
  }
  if (e instanceof Error && e.message.includes("535")) {
    return true;
  }
  return false;
}

async function run() {
  let runId: string | null = null;
  const tAll0 = performance.now();

  try {
    need("DATABASE_URL", process.env.DATABASE_URL);
    const smtpUser = need("ZOHO_SMTP_USER", process.env.ZOHO_SMTP_USER);
    need("ZOHO_SMTP_APP_PASSWORD", process.env.ZOHO_SMTP_APP_PASSWORD);
    need("FROM_EMAIL", process.env.FROM_EMAIL);
    need("PDF_WORKER_URL", process.env.PDF_WORKER_URL);
    need("PDF_WORKER_TOKEN", process.env.PDF_WORKER_TOKEN);
    if (!process.env.ZOHO_SMTP_HOST) {
      process.env.ZOHO_SMTP_HOST = "smtp.zoho.com";
    }
    if (!process.env.ZOHO_SMTP_PORT) {
      process.env.ZOHO_SMTP_PORT = "465";
    }

    const to = process.env.TEST_EMAIL_TO?.trim() || smtpUser;

    const samplePath = join(root, SAMPLE_NAME);
    if (!existsSync(samplePath)) {
      throw new Error("Missing sample_landscaping_contract.html in project root.");
    }

    console.log("Testing database connection…");
    await testDbConnection();
    console.log("Database connection OK.\n");

    const raw = readFileSync(samplePath);
    const fileSize = raw.length;
    const sha256 = createHash("sha256").update(raw).digest("hex");
    const ext = ".html";
    const html = raw.toString("utf8");

    runId = await createConversionRun({
      recipientEmail: to,
      originalFilename: SAMPLE_NAME,
      originalFileExtension: ext,
      originalFileSizeBytes: fileSize,
      originalFileSha256: sha256,
      outputFilename: "sample_landscaping_contract.pdf",
    });
    console.log("Created conversion run, id:", runId);

    const tPipeline0 = performance.now();
    const sanitized = sanitizeHtml(html);
    const t0 = performance.now();
    const pdf = await convertHtmlToPdf({
      html: sanitized,
      runId,
    });
    const t1 = performance.now();
    const renderDurationMs = Math.round(t1 - t0);
    if (pdf.length <= 1000) {
      throw new Error(
        `Expected PDF buffer larger than 1KB, got ${pdf.length} bytes.`
      );
    }
    console.log(
      "PDF size (bytes):",
      pdf.length,
      "| render (ms):",
      renderDurationMs
    );

    const t2 = performance.now();
    await sendPdfEmail({
      to,
      pdfBuffer: pdf,
      originalFilename: SAMPLE_NAME,
    });
    const t3 = performance.now();
    const emailDurationMs = Math.round(t3 - t2);
    const totalDurationMs = Math.round(t3 - tPipeline0);
    console.log(
      "Email send OK (ms):",
      emailDurationMs,
      "| total pipeline (ms):",
      totalDurationMs
    );

    await markConversionCompleted({
      id: runId,
      outputFileSizeBytes: pdf.length,
      renderDurationMs,
      emailDurationMs,
      totalDurationMs,
    });

    const row = (await getConversionRunById(runId)) as Record<string, unknown>;
    assert(
      String(row["status"]) === "completed",
      "status is completed"
    );
    assert(
      String(row["recipient_email"]).toLowerCase() === to.toLowerCase(),
      "recipient_email"
    );
    const outBytes = Number(row["output_file_size_bytes"]);
    assert(outBytes > 1000, "output_file_size_bytes > 1000");
    assert(
      row["render_duration_ms"] != null,
      "render_duration_ms not null"
    );
    assert(
      row["email_duration_ms"] != null,
      "email_duration_ms not null"
    );
    assert(
      row["total_duration_ms"] != null,
      "total_duration_ms not null"
    );

    console.log("\nPIPELINE TEST PASSED");
    console.log("Run ID:", runId);
    console.log("Email sent to:", to);
    console.log("PDF bytes:", pdf.length);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (runId) {
      try {
        await markConversionFailed({
          id: runId,
          errorMessage: err.message,
          errorCode: getErrCode(e),
          totalDurationMs: Math.round(performance.now() - tAll0),
        });
        // stderr so ordering stays next to the failure block (stdout can interleave)
        console.error(`Marked run ${runId} as failed in DB.`);
      } catch (dbE) {
        console.error("markConversionFailed also failed:", dbE);
      }
    }
    console.error("\nPIPELINE TEST FAILED");
    console.error("Run ID:", runId ?? "(none)");
    console.error("Reason:", err.message);
    if (getErrCode(e) === "EAUTH" || isSmtp535(e)) {
      console.error(
        "\nZoho SMTP login failed (EAUTH/535). Check:\n" +
          "  - ZOHO_SMTP_USER is your full Zoho Mail address\n" +
          "  - ZOHO_SMTP_APP_PASSWORD is a Zoho *application password* (Zoho Mail → Security → App passwords), not the account password\n" +
          "  - No extra spaces or line breaks in .env (we trim most issues)\n" +
          "  - Try ZOHO_SMTP_PORT=465 and ZOHO_SMTP_HOST=smtp.zoho.com, or 587/STARTTLS for some accounts\n" +
          "  - Zoho EU accounts: smtp.zoho.eu\n"
      );
    }
    if (err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

void run().then(() => {
  process.exit(0);
});
