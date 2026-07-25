import { PDFDocument } from "pdf-lib";

export const MAX_MERGE_FILES = 20;
export const MAX_MERGE_FILE_BYTES = 20 * 1024 * 1024; // 20MB per file
export const MAX_MERGE_TOTAL_BYTES = 50 * 1024 * 1024; // 50MB total

export type MergePdfInput = {
  name: string;
  bytes: Uint8Array;
};

export type MergePdfResult =
  | { ok: true; pdfBytes: Uint8Array; pageCount: number }
  | { ok: false; error: string };

function hasPdfExtension(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  // "%PDF-"
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/**
 * Merges PDF files in order into a single PDF document.
 */
export async function mergePdfFiles(
  files: MergePdfInput[]
): Promise<MergePdfResult> {
  if (files.length < 2) {
    return { ok: false, error: "Upload at least 2 PDF files to merge." };
  }
  if (files.length > MAX_MERGE_FILES) {
    return {
      ok: false,
      error: `You can merge at most ${MAX_MERGE_FILES} PDF files at once.`,
    };
  }

  let totalBytes = 0;
  for (const file of files) {
    if (!hasPdfExtension(file.name)) {
      return {
        ok: false,
        error: `"${file.name}" is not a PDF. Only .pdf files are allowed.`,
      };
    }
    if (file.bytes.length === 0) {
      return { ok: false, error: `"${file.name}" is empty.` };
    }
    if (file.bytes.length > MAX_MERGE_FILE_BYTES) {
      return {
        ok: false,
        error: `"${file.name}" exceeds the ${MAX_MERGE_FILE_BYTES / 1024 / 1024}MB per-file limit.`,
      };
    }
    if (!looksLikePdf(file.bytes)) {
      return {
        ok: false,
        error: `"${file.name}" does not look like a valid PDF.`,
      };
    }
    totalBytes += file.bytes.length;
  }

  if (totalBytes > MAX_MERGE_TOTAL_BYTES) {
    return {
      ok: false,
      error: `Combined upload exceeds the ${MAX_MERGE_TOTAL_BYTES / 1024 / 1024}MB total limit.`,
    };
  }

  try {
    const merged = await PDFDocument.create();
    let pageCount = 0;

    for (const file of files) {
      const source = await PDFDocument.load(file.bytes, {
        ignoreEncryption: false,
      });
      const pages = await merged.copyPages(source, source.getPageIndices());
      for (const page of pages) {
        merged.addPage(page);
        pageCount += 1;
      }
    }

    if (pageCount === 0) {
      return { ok: false, error: "The selected PDFs contain no pages." };
    }

    const pdfBytes = await merged.save();
    return { ok: true, pdfBytes, pageCount };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/encrypted|password/i.test(message)) {
      return {
        ok: false,
        error: "One or more PDFs are password-protected and cannot be merged.",
      };
    }
    return {
      ok: false,
      error: `Failed to merge PDFs: ${message}`,
    };
  }
}
