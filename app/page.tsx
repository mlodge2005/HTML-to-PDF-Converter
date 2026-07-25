"use client";

import { useState } from "react";
import { ConvertModal } from "@/components/ConvertModal";
import { MergePdfModal } from "@/components/MergePdfModal";
import { PngToSvgModal } from "@/components/PngToSvgTool";

type ServiceTab = "html-pdf" | "merge-pdf" | "image-convert";

export default function Home() {
  const [tab, setTab] = useState<ServiceTab>("html-pdf");
  const [open, setOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [pngOpen, setPngOpen] = useState(false);
  /** Increment to remount the modal and reset its internal form state on each open. */
  const [openRound, setOpenRound] = useState(0);
  const [mergeOpenRound, setMergeOpenRound] = useState(0);
  const [pngOpenRound, setPngOpenRound] = useState(0);

  const tabCopy = {
    "html-pdf": {
      headline: "Turn HTML into a print-ready PDF",
      description:
        "Upload an HTML file, add your email, and we will run it through a secure headless browser and email you a Letter-size PDF. Scripts and live network content are not loaded for v1, so your static layouts stay predictable.",
      cta: "Convert HTML to PDF",
      bullets: [
        "Upload your HTML file.",
        <>
          If your HTML references local images like <code>image.jpg</code> or{" "}
          <code>assets/chart.png</code>, upload a ZIP containing those files.
        </>,
        "Keep the same folder structure inside the ZIP as the HTML references.",
        "Base64 images and public image URLs work without a ZIP.",
      ],
    },
    "merge-pdf": {
      headline: "Upload and merge PDF files",
      description:
        "Select two or more PDFs, rearrange the order, and download one combined file. Merging runs in your browser—files never leave your device.",
      cta: "Merge PDFs",
      bullets: [
        "Upload two or more .pdf files (up to 20).",
        "Use ↑ / ↓ to set the page order before merging.",
        "Each file can be up to 20MB; combined uploads up to 50MB.",
        "Password-protected PDFs are not supported.",
      ],
    },
    "image-convert": {
      headline: "Convert PNG, JPEG, SVG, and MP4 formats quickly",
      description:
        "Run quick client-side conversions: PNG to JPEG, JPEG to SVG, PNG/JPEG to PDF, SVG to PDF/GIF/MP4, MP4 to GIF (browser FFmpeg), plus PNG SVG wrap/trace options.",
      cta: "Open Image Converter",
      bullets: [
        "Convert PNG to JPEG and PNG/JPEG to PDF in one click.",
        "Convert JPEG to SVG and SVG to PDF from the same modal.",
        "Turn MP4 clips into GIFs locally and export SVGs to GIF/MP4 with size controls.",
        "Includes optional PNG raster-wrap and simple vector-trace SVG tools.",
      ],
    },
  } as const;

  const copy = tabCopy[tab];

  return (
    <div className="relative min-h-dvh flex flex-col">
      <header className="border-b border-zinc-200/80 bg-white/80 dark:border-zinc-800/80 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Conversion Studio
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-5 inline-flex w-fit flex-wrap rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
          {(
            [
              ["html-pdf", "HTML → PDF"],
              ["merge-pdf", "Merge PDFs"],
              ["image-convert", "Image Convert"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                tab === id
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-zinc-100"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
          Simple, fast conversion tools
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance text-zinc-900 dark:text-zinc-100 sm:text-5xl">
          {copy.headline}
        </h1>
        <p className="mt-4 text-lg text-pretty text-zinc-600 dark:text-zinc-400">
          {copy.description}
        </p>

        <ul className="mt-8 space-y-3 text-zinc-700 dark:text-zinc-300">
          {copy.bullets.map((bullet, i) => (
            <li key={`${tab}-${i}`} className="flex gap-3 text-sm sm:text-base">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"
                aria-hidden
              />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>

        <div className="mt-10">
          <button
            type="button"
            onClick={() => {
              if (tab === "html-pdf") {
                setOpenRound((n) => n + 1);
                setOpen(true);
                return;
              }
              if (tab === "merge-pdf") {
                setMergeOpenRound((n) => n + 1);
                setMergeOpen(true);
                return;
              }
              setPngOpenRound((n) => n + 1);
              setPngOpen(true);
            }}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-zinc-900 px-8 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {copy.cta}
          </button>
        </div>
      </main>

      <footer className="border-t border-zinc-200/80 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800/80">
        <p>Built with Next.js, Playwright, Resend, and Neon.</p>
      </footer>

      <ConvertModal
        key={`convert-${openRound}`}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
      <MergePdfModal
        key={`merge-${mergeOpenRound}`}
        isOpen={mergeOpen}
        onClose={() => setMergeOpen(false)}
      />
      <PngToSvgModal
        key={`image-${pngOpenRound}`}
        isOpen={pngOpen}
        onClose={() => setPngOpen(false)}
      />
    </div>
  );
}
