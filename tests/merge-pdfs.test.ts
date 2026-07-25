import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { mergePdfFiles } from "@/lib/pdf/mergePdfs";

async function makePdfBytes(label: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawText(label, { x: 40, y: 100, size: 18 });
  return doc.save();
}

test("rejects fewer than 2 files", async () => {
  const a = await makePdfBytes("A");
  const result = await mergePdfFiles([{ name: "a.pdf", bytes: a }]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /at least 2/i);
});

test("rejects non-pdf extension", async () => {
  const a = await makePdfBytes("A");
  const b = await makePdfBytes("B");
  const result = await mergePdfFiles([
    { name: "a.pdf", bytes: a },
    { name: "notes.txt", bytes: b },
  ]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /not a PDF/i);
});

test("merges two PDFs into one document", async () => {
  const a = await makePdfBytes("A");
  const b = await makePdfBytes("B");
  const result = await mergePdfFiles([
    { name: "a.pdf", bytes: a },
    { name: "b.pdf", bytes: b },
  ]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pageCount, 2);
  assert.ok(result.pdfBytes.length > 0);

  const merged = await PDFDocument.load(result.pdfBytes);
  assert.equal(merged.getPageCount(), 2);
});
