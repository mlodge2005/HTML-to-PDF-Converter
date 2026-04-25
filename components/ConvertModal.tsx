"use client";

import { useEffect, useId, useRef, useState } from "react";

type ModalState = "idle" | "loading" | "success" | "error";

type FieldErrors = Record<string, string[] | undefined>;

type ConvertModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const GENERIC = "Something went wrong. Please try again.";

export function ConvertModal({ isOpen, onClose }: ConvertModalProps) {
  const titleId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<ModalState>("idle");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setState("error");
      setMessage("Please choose an HTML file.");
      return;
    }

    setState("loading");
    setMessage("");

    const formData = new FormData();
    formData.set("email", email.trim());
    formData.set("file", file, file.name);

    try {
      const res = await fetch("/api/convert", { method: "POST", body: formData });
      const data: unknown = await res.json();
      if (
        !data ||
        typeof data !== "object" ||
        !("ok" in data) ||
        typeof (data as { ok: unknown }).ok !== "boolean"
      ) {
        setState("error");
        setMessage(GENERIC);
        return;
      }
      const body = data as {
        ok: boolean;
        error?: string;
        fieldErrors?: FieldErrors;
        message?: string;
      };
      if (!res.ok || !body.ok) {
        setState("error");
        setMessage(body.error || GENERIC);
        if (body.fieldErrors) setFieldErrors(body.fieldErrors);
        return;
      }
      setState("success");
      setMessage(
        body.message || "We emailed your PDF. It may take a moment to arrive."
      );
    } catch {
      setState("error");
      setMessage(
        "We could not reach the server. Check your connection and try again."
      );
    }
  };

  if (!isOpen) return null;

  const fileError =
    fieldErrors?.filename?.[0] ||
    fieldErrors?.fileSizeBytes?.[0] ||
    fieldErrors?.file?.[0];
  const emailError = fieldErrors?.email?.[0];

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
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl shadow-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2
              id={titleId}
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
            >
              Convert to PDF
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Upload an HTML file and we will email you the generated PDF.
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
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="html-file"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                HTML file
              </label>
              <input
                ref={fileInputRef}
                id="html-file"
                name="file"
                type="file"
                accept=".html,.htm,text/html"
                disabled={state === "loading"}
                className="block w-full cursor-pointer rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-zinc-200 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950/50 file:dark:bg-zinc-700 file:dark:text-zinc-100"
              />
              {fileError && (
                <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                  {fileError}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="user-email"
                className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Your email
              </label>
              <input
                id="user-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={state === "loading"}
                placeholder="you@company.com"
                className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm transition placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
              {emailError && (
                <p className="mt-1.5 text-sm text-red-600 dark:text-red-400">
                  {emailError}
                </p>
              )}
            </div>

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
              disabled={state === "loading"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "loading" && (
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  aria-hidden
                />
              )}
              {state === "loading" ? "Converting…" : "Convert and email PDF"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
