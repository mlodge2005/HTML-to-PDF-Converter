import test from "node:test";
import assert from "node:assert/strict";
import { isUnsafeZipEntryPath } from "@/lib/convert/resolveHtmlAssets";

test("rejects zip entries with traversal or absolute paths", () => {
  assert.equal(isUnsafeZipEntryPath("../a.png"), true);
  assert.equal(isUnsafeZipEntryPath("assets/../../a.png"), true);
  assert.equal(isUnsafeZipEntryPath("/root/a.png"), true);
  assert.equal(isUnsafeZipEntryPath("C:/root/a.png"), true);
  assert.equal(isUnsafeZipEntryPath("assets\\a.png"), true);
});

test("accepts normal relative zip entries", () => {
  assert.equal(isUnsafeZipEntryPath("assets/chart.png"), false);
  assert.equal(isUnsafeZipEntryPath("image.jpg"), false);
});
