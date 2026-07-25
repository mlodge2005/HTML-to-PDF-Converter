"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  MAX_MERGE_FILE_BYTES,
  MAX_MERGE_FILES,
  mergePdfFiles,
} from "@/lib/pdf/mergePdfs";

type ModalState = "idle" | "loading" | "success" | "error";

type MergePdfModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

type SelectedPdf = {
  id: string;
  file: File;
};

const GENERIC = "Something went wrong. Please try again.";

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MergePdfModal({ isOpen, onClose }: MergePdfModalProps) {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SelectedPdf[]>([]);
  const [state, setState] = useState<ModalState>("idle");
  const [message, setMessage] = useState("");
  const [pageCount, setPageCount] = useState<number | null>(null);

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

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setMessage("");
    setState("idle");
    setPageCount(null);

    const next: SelectedPdf[] = [...files];
    for (const file of Array.from(list)) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setState("error");
        setMessage(`"${file.name}" is not a PDF. Only .pdf files are allowed.`);
        continue;
      }
      if (file.size > MAX_MERGE_FILE_BYTES) {
        setState("error");
        setMessage(
          `"${file.name}" exceeds the ${MAX_MERGE_FILE_BYTES / 1024 / 1024}MB per-file limit.`
        );
        continue;
      }
      if (next.length >= MAX_MERGE_FILES) {
        setState("error");
        setMessage(`You can merge at most ${MAX_MERGE_FILES} PDF files at once.`);
        break;
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
      });
    }
    setFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setMessage("");
    setState("idle");
    setPageCount(null);
  };

  const moveFile = (id: string, direction: -1 | 1) => {
    setFiles((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx < 0) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
    setPageCount(null);
  };

  const handleMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length < 2) {
      setState("error");
      setMessage("Upload at least 2 PDF files to merge.");
      return;
    }

    setState("loading");
    setMessage("");
    setPageCount(null);

    try {
      const inputs = await Promise.all(
        files.map(async ({ file }) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        }))
      );
      const result = await mergePdfFiles(inputs);
      if (!result.ok) {
        setState("error");
        setMessage(result.error);
        return;
      }

      const blob = new Blob([new Uint8Array(result.pdfBytes)], {
        type: "application/pdf",
      });
      downloadBlob("merged.pdf", blob);
      setPageCount(result.pageCount);
      setState("success");
      setMessage(
        `Merged ${files.length} PDFs into one file (${result.pageCount} pages). Download started.`
      );
    } catch {
      setState("error");
      setMessage(GENERIC);
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
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl shadow-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2
              id={titleId}
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Merge PDFs
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Upload two or more PDF files, arrange the order, and download one
              combined PDF.
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

        {state === "success" ? (
          <div className="space-y-4">
            <div
              className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
              role="status"
            >
              {message}
              {pageCount != null && (
                <span className="mt-1 block text-xs opacity-80">
                  Output: merged.pdf · {pageCount} pages
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleMerge} className="space-y-4">
            <div>
              <label
                htmlFor="merge-pdfs"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                PDF files
              </label>
              <input
                ref={fileInputRef}
                id="merge-pdfs"
                name="pdfs"
                type="file"
                accept=".pdf,application/pdf"
                multiple
                disabled={state === "loading"}
                onChange={(e) => addFiles(e.target.files)}
                className="block w-full cursor-pointer rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950/50 file:dark:bg-zinc-700 file:dark:text-zinc-100"
              />
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                Up to {MAX_MERGE_FILES} files · {MAX_MERGE_FILE_BYTES / 1024 / 1024}
                MB each · merge runs in your browser
              </p>
            </div>

            {files.length > 0 && (
              <ul className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                {files.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2 rounded-md bg-zinc-50 px-2 py-2 text-sm dark:bg-zinc-950/50"
                  >
                    <span className="w-6 shrink-0 text-center text-xs text-zinc-400">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-zinc-800 dark:text-zinc-100">
                        {item.file.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {formatBytes(item.file.size)}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        disabled={state === "loading" || index === 0}
                        onClick={() => moveFile(item.id, -1)}
                        className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        aria-label={`Move ${item.file.name} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={
                          state === "loading" || index === files.length - 1
                        }
                        onClick={() => moveFile(item.id, 1)}
                        className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        aria-label={`Move ${item.file.name} down`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        disabled={state === "loading"}
                        onClick={() => removeFile(item.id)}
                        className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        aria-label={`Remove ${item.file.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {state === "error" && message && (
              <p
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                role="alert"
              >
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={state === "loading" || files.length < 2}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "loading" && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden
                />
              )}
              {state === "loading"
                ? "Merging…"
                : files.length < 2
                  ? "Select at least 2 PDFs"
                  : `Merge ${files.length} PDFs`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
