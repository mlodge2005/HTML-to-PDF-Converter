import test from "node:test";
import assert from "node:assert/strict";
import {
  detectRequestMode,
  normalizeJsonPayload,
  normalizeMultipartFormData,
} from "@/lib/convert/normalizeConvertInput";

test("detectRequestMode handles supported and unsupported content types", () => {
  assert.equal(detectRequestMode("application/json"), "json");
  assert.equal(
    detectRequestMode("multipart/form-data; boundary=abc"),
    "multipart"
  );
  assert.equal(detectRequestMode("text/plain"), "unsupported");
});

test("normalizeJsonPayload accepts html canonical input", () => {
  const result = normalizeJsonPayload({ html: "<html>ok</html>", runId: "r1" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.normalizedInputType, "html");
  assert.equal(result.runId, "r1");
  assert.equal(result.html, "<html>ok</html>");
});

test("normalizeJsonPayload supports compatibility alias content", () => {
  const result = normalizeJsonPayload({ content: "<html>alias</html>" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.normalizedInputType, "content");
  assert.equal(result.html, "<html>alias</html>");
});

test("normalizeJsonPayload rejects url-only requests", () => {
  const result = normalizeJsonPayload({ url: "https://example.com" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.match(result.details ?? "", /URL-only conversion is not supported/i);
});

test("normalizeMultipartFormData returns canonical html from file", async () => {
  const fd = new FormData();
  fd.set("email", "user@example.com");
  fd.set("file", new File(["<html><body>ok</body></html>"], "sample.html"));

  const result = await normalizeMultipartFormData(fd);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.normalizedInputType, "file");
  assert.equal(result.html, "<html><body>ok</body></html>");
});

test("normalizeMultipartFormData rejects missing file", async () => {
  const fd = new FormData();
  fd.set("email", "user@example.com");

  const result = await normalizeMultipartFormData(fd);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.equal(result.error, "Please upload an HTML file.");
});
