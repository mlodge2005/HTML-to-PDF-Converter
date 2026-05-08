import test from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/convert/route";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

function setWorkerEnv() {
  process.env.PDF_WORKER_URL = "https://worker.example.com/convert";
  process.env.PDF_WORKER_TOKEN = "token";
}

function restoreAll() {
  process.env = { ...ORIGINAL_ENV };
  global.fetch = ORIGINAL_FETCH;
}

test.afterEach(() => {
  restoreAll();
});

test("rejects malformed JSON with structured error", async () => {
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, "Malformed JSON");
});

test("rejects unsupported content-type with structured error", async () => {
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "hello",
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 415);
  assert.equal(body.error, "Unsupported content-type");
});

test("rejects url-only mode before worker call", async () => {
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, "Missing input");
  assert.match(body.details, /URL-only conversion is not supported/i);
});

test("rejects empty html after trim", async () => {
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "   " }),
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, "Missing input");
});

test("multipart invalid request returns 400", async () => {
  const fd = new FormData();
  fd.set("email", "user@example.com");

  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    body: fd,
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, "Please upload an HTML file.");
});

test("multipart rejects non-zip asset upload", async () => {
  const fd = new FormData();
  fd.set("htmlFile", new File(["<html><body>ok</body></html>"], "index.html"));
  fd.set("assetZip", new File(["not zip"], "assets.txt"));
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    body: fd,
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, "Asset ZIP must be a .zip file.");
});

test("multipart returns missing relative assets when not in zip", async () => {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip();
  zip.addFile("other.png", Buffer.from("img"));
  const fd = new FormData();
  fd.set(
    "htmlFile",
    new File(
      ['<html><body><img src="assets/chart.png" /></body></html>'],
      "index.html"
    )
  );
  fd.set("assetZip", new File([zip.toBuffer()], "assets.zip"));
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    body: fd,
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, "Missing asset files");
  assert.deepEqual(body.missingPaths, ["assets/chart.png"]);
});

test("multipart success returns binary PDF when email is omitted", async () => {
  setWorkerEnv();
  global.fetch = async () =>
    new Response(new Uint8Array([4, 5, 6]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  const fd = new FormData();
  fd.set(
    "htmlFile",
    new File(["<html><body><h1>Multipart</h1></body></html>"], "index.html")
  );
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    body: fd,
  });
  const res = await POST(req);
  const body = await res.arrayBuffer();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(body.byteLength, 3);
});

test("json html success returns binary PDF", async () => {
  setWorkerEnv();
  global.fetch = async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });

  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body>Hello</body></html>" }),
  });
  const res = await POST(req);
  const ab = await res.arrayBuffer();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(ab.byteLength, 3);
});

test("json content alias success returns binary PDF", async () => {
  setWorkerEnv();
  global.fetch = async () =>
    new Response(new Uint8Array([9, 8, 7, 6]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });

  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "<html><body>Alias</body></html>" }),
  });
  const res = await POST(req);
  const ab = await res.arrayBuffer();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(ab.byteLength, 4);
});

test("worker timeout maps to structured worker failure", async () => {
  setWorkerEnv();
  global.fetch = async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body>timeout</body></html>" }),
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.error, "PDF worker failed");
  assert.match(body.details, /timed out/i);
});

test("worker non-200 maps to structured worker failure", async () => {
  setWorkerEnv();
  global.fetch = async () =>
    new Response("worker boom", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body>fail</body></html>" }),
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.error, "PDF worker failed");
  assert.equal(body.status, 500);
});

test("zero-byte PDF is rejected", async () => {
  setWorkerEnv();
  global.fetch = async () =>
    new Response(new Uint8Array([]), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  const req = new Request("http://localhost/api/convert", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: "<html><body>zero</body></html>" }),
  });
  const res = await POST(req);
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.error, "PDF worker failed");
  assert.match(body.details, /empty PDF/i);
});
