import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

const LOCAL_REF_PATTERNS = {
  imgSrc: /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
  cssUrl: /(url\(\s*["']?)([^"')]+)(["']?\s*\))/gi,
};

function isExternalOrEmbeddedRef(ref: string): boolean {
  const lowered = ref.toLowerCase();
  return (
    lowered.startsWith("data:") ||
    lowered.startsWith("http://") ||
    lowered.startsWith("https://") ||
    lowered.startsWith("//")
  );
}

function normalizeAssetRef(rawRef: string): string {
  const cleaned = rawRef.split("?")[0]?.split("#")[0]?.trim() ?? "";
  const decoded = decodeURIComponent(cleaned);
  const normalized = path.posix.normalize(decoded.replaceAll("\\", "/"));
  return normalized.replace(/^\.?\//, "");
}

export function isUnsafeZipEntryPath(entryName: string): boolean {
  if (!entryName || entryName.includes("\\")) {
    return true;
  }
  if (entryName.startsWith("/") || /^[a-zA-Z]:/.test(entryName)) {
    return true;
  }
  const parts = entryName.split("/");
  return parts.some((part) => part === "..");
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const byExt: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".css": "text/css",
    ".js": "text/javascript",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
  };
  return byExt[ext] ?? "application/octet-stream";
}

async function extractZipToTemp(zipBuf: Buffer): Promise<string> {
  const extractionRoot = await fs.mkdtemp(path.join(tmpdir(), "html-assets-"));
  const zip = new AdmZip(zipBuf);
  const entries = zip.getEntries();

  for (const entry of entries) {
    const entryName = entry.entryName;
    if (isUnsafeZipEntryPath(entryName)) {
      throw new Error(`Unsafe ZIP entry path: ${entryName}`);
    }
    const normalized = path.posix.normalize(entryName).replace(/^\.?\//, "");
    if (!normalized) {
      continue;
    }
    const outPath = path.resolve(extractionRoot, normalized);
    if (!outPath.startsWith(`${extractionRoot}${path.sep}`) && outPath !== extractionRoot) {
      throw new Error(`Unsafe ZIP entry path: ${entryName}`);
    }
    if (entry.isDirectory) {
      await fs.mkdir(outPath, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, entry.getData());
  }
  return extractionRoot;
}

function collectLocalRefs(html: string): string[] {
  const refs = new Set<string>();
  for (const pattern of Object.values(LOCAL_REF_PATTERNS)) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const ref = match[2]?.trim();
      if (!ref || isExternalOrEmbeddedRef(ref)) {
        continue;
      }
      const normalized = normalizeAssetRef(ref);
      if (!normalized || normalized.startsWith("..")) {
        continue;
      }
      refs.add(normalized);
    }
    pattern.lastIndex = 0;
  }
  return Array.from(refs);
}

function applyInlinedAssets(
  html: string,
  resolvedDataUrls: Map<string, string>
): string {
  let next = html;
  next = next.replace(LOCAL_REF_PATTERNS.imgSrc, (full, p1, ref, p3) => {
    if (isExternalOrEmbeddedRef(ref)) {
      return full;
    }
    const normalized = normalizeAssetRef(ref);
    const replacement = resolvedDataUrls.get(normalized);
    if (!replacement) {
      return full;
    }
    return `${p1}${replacement}${p3}`;
  });
  next = next.replace(LOCAL_REF_PATTERNS.cssUrl, (full, p1, ref, p3) => {
    if (isExternalOrEmbeddedRef(ref)) {
      return full;
    }
    const normalized = normalizeAssetRef(ref);
    const replacement = resolvedDataUrls.get(normalized);
    if (!replacement) {
      return full;
    }
    return `${p1}${replacement}${p3}`;
  });
  return next;
}

export async function inlineHtmlAssetsFromZip(args: {
  html: string;
  zipBuffer: Buffer;
}): Promise<{ html: string; missingPaths: string[] }> {
  const refs = collectLocalRefs(args.html);
  if (refs.length === 0) {
    return { html: args.html, missingPaths: [] };
  }

  const root = await extractZipToTemp(args.zipBuffer);
  try {
    const resolved = new Map<string, string>();
    const missing: string[] = [];

    for (const assetRef of refs) {
      const resolvedPath = path.resolve(root, assetRef);
      if (!resolvedPath.startsWith(`${root}${path.sep}`) && resolvedPath !== root) {
        missing.push(assetRef);
        continue;
      }
      let assetBuffer: Buffer;
      try {
        assetBuffer = await fs.readFile(resolvedPath);
      } catch {
        missing.push(assetRef);
        continue;
      }
      const mime = mimeFromPath(assetRef);
      const dataUrl = `data:${mime};base64,${assetBuffer.toString("base64")}`;
      resolved.set(assetRef, dataUrl);
    }

    return {
      html: applyInlinedAssets(args.html, resolved),
      missingPaths: missing,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
