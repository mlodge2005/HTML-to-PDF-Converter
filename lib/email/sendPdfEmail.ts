import nodemailer from "nodemailer";

export function resolvePdfFilename(
  originalFilename: string | undefined
): string {
  if (!originalFilename?.trim()) {
    return "converted.pdf";
  }
  const base = originalFilename.replace(/\.(html|htm)$/i, "");
  if (!base.trim()) {
    return "converted.pdf";
  }
  return `${base}.pdf`;
}

/** Strips surrounding whitespace and stray CR/BOM (common in pasted .env values on Windows). */
function cleanSmtpSecret(value: string): string {
  return value
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/\r$/, "");
}

function getSmtpConfig(): {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  user: string;
  pass: string;
  from: string;
} {
  const user = process.env.ZOHO_SMTP_USER;
  const pass = process.env.ZOHO_SMTP_APP_PASSWORD;
  const from = process.env.FROM_EMAIL;

  if (!user?.trim() || !pass?.trim()) {
    throw new Error("Zoho SMTP credentials are not configured (ZOHO_SMTP_USER, ZOHO_SMTP_APP_PASSWORD).");
  }
  if (!from?.trim()) {
    throw new Error("FROM_EMAIL is not configured.");
  }

  const host = process.env.ZOHO_SMTP_HOST || "smtp.zoho.com";
  const port = parseInt(process.env.ZOHO_SMTP_PORT || "465", 10);
  if (Number.isNaN(port)) {
    throw new Error("Invalid ZOHO_SMTP_PORT.");
  }

  return {
    host: host.trim(),
    port,
    secure: port === 465,
    requireTLS: port === 587,
    user: cleanSmtpSecret(user),
    pass: cleanSmtpSecret(pass),
    from: cleanSmtpSecret(from),
  };
}

export async function sendPdfEmail(args: {
  to: string;
  pdfBuffer: Buffer;
  originalFilename?: string;
}): Promise<void> {
  const cfg = getSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: cfg.requireTLS,
    auth: { user: cfg.user, pass: cfg.pass },
  });

  const filename = resolvePdfFilename(args.originalFilename);

  await transporter.sendMail({
    from: cfg.from,
    to: args.to,
    subject: "Your converted PDF is ready",
    text: "Your HTML was converted to a PDF. You will find it attached.",
    attachments: [
      { filename, content: args.pdfBuffer, contentType: "application/pdf" },
    ],
  });
}
