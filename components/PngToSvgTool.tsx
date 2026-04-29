"use client";

import { useEffect, useMemo, useState } from "react";
import { jsPDF } from "jspdf";

type Mode = "raster-wrap" | "simple-vector-trace";
type Operation =
  | "png-jpeg"
  | "jpeg-svg"
  | "png-pdf"
  | "jpeg-pdf"
  | "svg-pdf"
  | "png-svg-raster"
  | "png-svg-trace";

type TraceOptions = {
  alphaCutoff: number;
  whiteCutoff: number;
  quantStep: number;
};

type TraceRegion = {
  color: [number, number, number];
  pathData: string[];
};

const SVG_NS = "http://www.w3.org/2000/svg";

function xmlEscape(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed reading PNG file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mimeMatch = /data:(.*?);base64/.exec(head);
  const mime = mimeMatch?.[1] || "application/octet-stream";
  const bytes = atob(body || "");
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function fileToImageData(file: File): Promise<{
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}> {
  const dataUrl = await fileToDataUrl(file);
  const img = new Image();
  img.decoding = "async";
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context unavailable.");
  }
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  return { width: img.width, height: img.height, rgba: data.data };
}

function colorKey(r: number, g: number, b: number): string {
  return `${r},${g},${b}`;
}

function quantize(v: number, step: number): number {
  if (step <= 1) return v;
  const q = Math.round(v / step) * step;
  return Math.max(0, Math.min(255, q));
}

function detectRegions(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
  options: TraceOptions
): TraceRegion[] {
  const size = width * height;
  const colorId = new Int32Array(size);
  colorId.fill(-1);
  const colorList: [number, number, number][] = [];
  const colorToId = new Map<string, number>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = rgba[i + 3];
      if (a < options.alphaCutoff) continue;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      if (
        r >= options.whiteCutoff &&
        g >= options.whiteCutoff &&
        b >= options.whiteCutoff
      ) {
        continue;
      }
      const qr = quantize(r, options.quantStep);
      const qg = quantize(g, options.quantStep);
      const qb = quantize(b, options.quantStep);
      const key = colorKey(qr, qg, qb);
      let id = colorToId.get(key);
      if (id == null) {
        id = colorList.length;
        colorList.push([qr, qg, qb]);
        colorToId.set(key, id);
      }
      colorId[y * width + x] = id;
    }
  }

  const visited = new Uint8Array(size);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  const regions: TraceRegion[] = [];

  for (let idx = 0; idx < size; idx++) {
    if (visited[idx]) continue;
    const target = colorId[idx];
    if (target < 0) continue;

    const stack = [idx];
    visited[idx] = 1;
    const pixels: number[] = [];

    while (stack.length) {
      const p = stack.pop() as number;
      pixels.push(p);
      const x = p % width;
      const y = (p / width) | 0;
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (visited[ni]) continue;
        if (colorId[ni] !== target) continue;
        visited[ni] = 1;
        stack.push(ni);
      }
    }

    const pathData = regionPixelsToPaths(width, height, pixels);
    if (pathData.length > 0) {
      regions.push({ color: colorList[target], pathData });
    }
  }
  return regions;
}

function regionPixelsToPaths(
  width: number,
  height: number,
  pixels: number[]
): string[] {
  const inRegion = new Uint8Array(width * height);
  for (const p of pixels) inRegion[p] = 1;

  type Edge = [number, number, number, number];
  const edges: Edge[] = [];

  for (const p of pixels) {
    const x = p % width;
    const y = (p / width) | 0;
    const top = y === 0 || !inRegion[(y - 1) * width + x];
    const right = x === width - 1 || !inRegion[y * width + (x + 1)];
    const bottom = y === height - 1 || !inRegion[(y + 1) * width + x];
    const left = x === 0 || !inRegion[y * width + (x - 1)];
    if (top) edges.push([x, y, x + 1, y]);
    if (right) edges.push([x + 1, y, x + 1, y + 1]);
    if (bottom) edges.push([x + 1, y + 1, x, y + 1]);
    if (left) edges.push([x, y + 1, x, y]);
  }

  const nextMap = new Map<string, string[]>();
  for (const [x1, y1, x2, y2] of edges) {
    const s = `${x1},${y1}`;
    const e = `${x2},${y2}`;
    const arr = nextMap.get(s);
    if (arr) arr.push(e);
    else nextMap.set(s, [e]);
  }

  const paths: string[] = [];

  while (nextMap.size > 0) {
    const start = nextMap.keys().next().value as string;
    const loop = [start];
    let cur = start;
    let guard = 0;
    while (guard < 200000) {
      guard++;
      const arr = nextMap.get(cur);
      if (!arr || arr.length === 0) break;
      const next = arr.pop() as string;
      if (arr.length === 0) nextMap.delete(cur);
      cur = next;
      loop.push(cur);
      if (cur === start) break;
    }
    const simplified = simplifyOrthogonalPath(loop);
    if (simplified.length > 3) {
      const [mx, my] = parsePoint(simplified[0]);
      let d = `M ${mx} ${my}`;
      for (let i = 1; i < simplified.length; i++) {
        const [x, y] = parsePoint(simplified[i]);
        d += ` L ${x} ${y}`;
      }
      d += " Z";
      paths.push(d);
    }
  }

  return paths;
}

function parsePoint(k: string): [number, number] {
  const [xs, ys] = k.split(",");
  return [Number(xs), Number(ys)];
}

function simplifyOrthogonalPath(points: string[]): string[] {
  if (points.length < 4) return points;
  const out: string[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = parsePoint(out[out.length - 1]);
    const b = parsePoint(points[i]);
    const c = parsePoint(points[i + 1]);
    const collinear =
      (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]);
    if (!collinear) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

function buildRasterWrapSvg(width: number, height: number, dataUrl: string): string {
  return [
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<image href="${xmlEscape(dataUrl)}" width="${width}" height="${height}" />`,
    "</svg>",
  ].join("");
}

function buildVectorSvg(width: number, height: number, regions: TraceRegion[]): string {
  const chunks = [
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision">`,
  ];
  for (const region of regions) {
    const [r, g, b] = region.color;
    const fill = `rgb(${r},${g},${b})`;
    const d = region.pathData.join(" ");
    chunks.push(`<path d="${d}" fill="${fill}" />`);
  }
  chunks.push("</svg>");
  return chunks.join("");
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type PngToSvgModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function PngToSvgModal({ isOpen, onClose }: PngToSvgModalProps) {
  const [operation, setOperation] = useState<Operation>("png-jpeg");
  const [mode, setMode] = useState<Mode>("raster-wrap");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [svg, setSvg] = useState("");
  const [svgName, setSvgName] = useState("converted.svg");
  const [meta, setMeta] = useState("");
  const [opts, setOpts] = useState<TraceOptions>({
    alphaCutoff: 20,
    whiteCutoff: 245,
    quantStep: 32,
  });

  const previewUrl = useMemo(() => {
    if (!svg) return "";
    const b = new Blob([svg], { type: "image/svg+xml" });
    return URL.createObjectURL(b);
  }, [svg]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const onFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError("");
    setMeta("");
    try {
      const name = file.name.toLowerCase();
      const isPng = file.type.includes("png") || name.endsWith(".png");
      const isJpeg =
        file.type.includes("jpeg") || name.endsWith(".jpg") || name.endsWith(".jpeg");
      const isSvg = file.type.includes("svg") || name.endsWith(".svg");
      const baseName = file.name.replace(/\.[^/.]+$/, "");

      if (
        (operation === "png-jpeg" ||
          operation === "png-pdf" ||
          operation === "png-svg-raster" ||
          operation === "png-svg-trace") &&
        !isPng
      ) {
        throw new Error("Please upload a PNG file for this conversion.");
      }
      if ((operation === "jpeg-svg" || operation === "jpeg-pdf") && !isJpeg) {
        throw new Error("Please upload a JPEG file for this conversion.");
      }
      if (operation === "svg-pdf" && !isSvg) {
        throw new Error("Please upload an SVG file for this conversion.");
      }

      if (operation === "png-jpeg") {
        const pngUrl = await fileToDataUrl(file);
        const img = new Image();
        img.src = pngUrl;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context unavailable.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const jpegUrl = canvas.toDataURL("image/jpeg", 0.92);
        downloadBlob(`${baseName || "converted"}.jpg`, dataUrlToBlob(jpegUrl));
        setMeta(`PNG converted to JPEG (${img.width}x${img.height}).`);
        setSvg("");
        return;
      }

      if (operation === "jpeg-svg") {
        const dataUrl = await fileToDataUrl(file);
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const out = buildRasterWrapSvg(img.width, img.height, dataUrl);
        setSvgName(`${baseName || "converted"}.svg`);
        setSvg(out);
        setMeta(`JPEG wrapped as SVG (${img.width}x${img.height}).`);
        return;
      }

      if (operation === "png-pdf" || operation === "jpeg-pdf") {
        const dataUrl = await fileToDataUrl(file);
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const doc = new jsPDF({
          orientation: img.width >= img.height ? "landscape" : "portrait",
          unit: "pt",
          format: [img.width, img.height],
        });
        const fmt = operation === "png-pdf" ? "PNG" : "JPEG";
        doc.addImage(dataUrl, fmt, 0, 0, img.width, img.height);
        doc.save(`${baseName || "converted"}.pdf`);
        setMeta(`${fmt} converted to PDF (${img.width}x${img.height}).`);
        setSvg("");
        return;
      }

      if (operation === "svg-pdf") {
        const svgText = await file.text();
        const svgBlob = new Blob([svgText], { type: "image/svg+xml" });
        const svgUrl = URL.createObjectURL(svgBlob);
        try {
          const img = new Image();
          img.src = svgUrl;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.width || 1200;
          canvas.height = img.height || 1200;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas context unavailable.");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const pngUrl = canvas.toDataURL("image/png");
          const doc = new jsPDF({
            orientation: canvas.width >= canvas.height ? "landscape" : "portrait",
            unit: "pt",
            format: [canvas.width, canvas.height],
          });
          doc.addImage(pngUrl, "PNG", 0, 0, canvas.width, canvas.height);
          doc.save(`${baseName || "converted"}.pdf`);
          setMeta(`SVG converted to PDF (${canvas.width}x${canvas.height}).`);
          setSvg("");
        } finally {
          URL.revokeObjectURL(svgUrl);
        }
        return;
      }

      setSvgName(`${baseName || "converted"}.svg`);
      const { width, height, rgba } = await fileToImageData(file);
      if (operation === "png-svg-raster" || mode === "raster-wrap") {
        const dataUrl = await fileToDataUrl(file);
        const out = buildRasterWrapSvg(width, height, dataUrl);
        setSvg(out);
        setMeta(`Raster wrap ready (${width}x${height}). Preserves exact pixels.`);
      } else {
        const regions = detectRegions(width, height, rgba, opts);
        const out = buildVectorSvg(width, height, regions);
        setSvg(out);
        setMeta(
          `Vector trace ready (${width}x${height}) with ${regions.length} color region(s). Best for logos/icons and flat graphics.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed converting PNG.");
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/60 p-4 backdrop-blur-sm sm:items-center"
      role="presentation"
      onMouseDown={onBackdrop}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl shadow-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              Image Conversion
            </h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Quick local conversions for common formats. Best results for logos, icons, flat graphics, and high-contrast images.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Close"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-zinc-700 dark:text-zinc-300">
            Conversion
            <select
              value={operation}
              onChange={(e) => {
                const next = e.target.value as Operation;
                setOperation(next);
                setSvg("");
                setMeta("");
                setError("");
                setMode(next === "png-svg-trace" ? "simple-vector-trace" : "raster-wrap");
              }}
              className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="png-jpeg">PNG → JPEG</option>
              <option value="jpeg-svg">JPEG → SVG (raster wrap)</option>
              <option value="png-pdf">PNG → PDF</option>
              <option value="jpeg-pdf">JPEG → PDF</option>
              <option value="svg-pdf">SVG → PDF</option>
              <option value="png-svg-raster">PNG → SVG (raster wrap)</option>
              <option value="png-svg-trace">PNG → SVG (simple vector trace)</option>
            </select>
          </label>
        </div>

        {(operation === "png-svg-raster" || operation === "png-svg-trace") && (
          <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("raster-wrap")}
            className={`rounded-lg px-3 py-2 text-sm ${mode === "raster-wrap" ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
          >
            Mode 1: Raster SVG Wrap
          </button>
          <button
            type="button"
            onClick={() => setMode("simple-vector-trace")}
            className={`rounded-lg px-3 py-2 text-sm ${mode === "simple-vector-trace" ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
          >
            Mode 2: Simple Vector Trace
          </button>
          </div>
        )}

        {(operation === "png-svg-raster" || operation === "png-svg-trace") &&
          mode === "simple-vector-trace" && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-zinc-700 dark:text-zinc-300">
              Alpha cutoff
              <input
                type="number"
                min={0}
                max={255}
                value={opts.alphaCutoff}
                onChange={(e) =>
                  setOpts((o) => ({ ...o, alphaCutoff: Number(e.target.value) || 0 }))
                }
                className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-sm text-zinc-700 dark:text-zinc-300">
              White cutoff
              <input
                type="number"
                min={0}
                max={255}
                value={opts.whiteCutoff}
                onChange={(e) =>
                  setOpts((o) => ({ ...o, whiteCutoff: Number(e.target.value) || 255 }))
                }
                className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="text-sm text-zinc-700 dark:text-zinc-300">
              Color quant step
              <input
                type="number"
                min={1}
                max={128}
                value={opts.quantStep}
                onChange={(e) =>
                  setOpts((o) => ({ ...o, quantStep: Math.max(1, Number(e.target.value) || 1) }))
                }
                className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>
        )}

        <div className="mt-5">
          <input
            type="file"
            accept={
              operation === "svg-pdf"
                ? ".svg,image/svg+xml"
                : operation === "jpeg-svg" || operation === "jpeg-pdf"
                  ? ".jpg,.jpeg,image/jpeg"
                  : ".png,image/png"
            }
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            className="block w-full cursor-pointer rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        {busy && <p className="mt-3 text-sm text-zinc-500">Processing image...</p>}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {meta && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{meta}</p>}

        {svg && (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadTextFile(svgName, svg)}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
              >
                Download SVG
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(svg)}
                className="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100"
              >
                Copy SVG markup
              </button>
            </div>
            {previewUrl && (
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="SVG preview" className="max-h-[360px] w-full object-contain bg-white dark:bg-zinc-900" />
              </div>
            )}
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Simple Vector Trace is intentionally basic and works best for logos, icons, flat graphics, and high-contrast images.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
