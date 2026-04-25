"use client";

import { useState } from "react";
import { ConvertModal } from "@/components/ConvertModal";

export default function Home() {
  const [open, setOpen] = useState(false);
  /** Increment to remount the modal and reset its internal form state on each open. */
  const [openRound, setOpenRound] = useState(0);

  return (
    <div className="relative min-h-dvh flex flex-col">
      <header className="border-b border-zinc-200/80 bg-white/80 dark:border-zinc-800/80 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            HTML → PDF
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-16 sm:px-6 sm:py-20">
        <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
          Simple, fast conversion
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance text-zinc-900 dark:text-zinc-100 sm:text-5xl">
          Turn HTML into a print-ready PDF
        </h1>
        <p className="mt-4 text-lg text-pretty text-zinc-600 dark:text-zinc-400">
          Upload an HTML file, add your email, and we will run it through a
          secure headless browser and email you a Letter-size PDF. Scripts and
          live network content are not loaded for v1, so your static layouts
          stay predictable.
        </p>

        <ul className="mt-8 space-y-3 text-zinc-700 dark:text-zinc-300">
          <li className="flex gap-3 text-sm sm:text-base">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"
              aria-hidden
            />
            <span>Upload a single .html or .htm file (up to 2MB).</span>
          </li>
          <li className="flex gap-3 text-sm sm:text-base">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"
              aria-hidden
            />
            <span>
              We remove scripts and event handlers, then render with Chromium
              to PDF.
            </span>
          </li>
          <li className="flex gap-3 text-sm sm:text-base">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500"
              aria-hidden
            />
            <span>Your PDF is sent to the email you provide—nothing else required.</span>
          </li>
        </ul>

        <div className="mt-10">
          <button
            type="button"
            onClick={() => {
              setOpenRound((n) => n + 1);
              setOpen(true);
            }}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-zinc-900 px-8 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            Convert HTML to PDF
          </button>
        </div>
      </main>

      <footer className="border-t border-zinc-200/80 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800/80">
        <p>Built with Next.js, Playwright, Resend, and Neon.</p>
      </footer>

      <ConvertModal
        key={openRound}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
