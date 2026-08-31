const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeBrandAssets } = require("../controllers/intakeController");

test("sanitizeBrandAssets returns an empty array for a non-array input", () => {
  assert.deepEqual(sanitizeBrandAssets("not-an-array"), []);
  assert.deepEqual(sanitizeBrandAssets(null), []);
  assert.deepEqual(sanitizeBrandAssets(undefined), []);
});

test("sanitizeBrandAssets keeps a well-formed entry", () => {
  const result = sanitizeBrandAssets([
    { path: "brand-assets/abc123.png", filename: "logo.png", contentType: "image/png", sizeBytes: 5000 },
  ]);
  assert.deepEqual(result, [
    { path: "brand-assets/abc123.png", filename: "logo.png", contentType: "image/png", sizeBytes: 5000 },
  ]);
});

test("sanitizeBrandAssets strips a path-traversal attempt (wrong prefix)", () => {
  const result = sanitizeBrandAssets([
    { path: "../etc/passwd", filename: "evil", contentType: "image/png", sizeBytes: 1 },
  ]);
  assert.deepEqual(result, []);
});

test("sanitizeBrandAssets strips a disallowed content type", () => {
  const result = sanitizeBrandAssets([
    { path: "brand-assets/virus.exe", filename: "virus.exe", contentType: "application/x-msdownload", sizeBytes: 1 },
  ]);
  assert.deepEqual(result, []);
});

test("sanitizeBrandAssets drops non-object entries in the array", () => {
  const result = sanitizeBrandAssets(["not-an-object", 42, null, { path: "brand-assets/ok.pdf", filename: "ok.pdf", contentType: "application/pdf", sizeBytes: 10 }]);
  assert.deepEqual(result, [{ path: "brand-assets/ok.pdf", filename: "ok.pdf", contentType: "application/pdf", sizeBytes: 10 }]);
});

test("sanitizeBrandAssets caps the list at 5 entries", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    path: `brand-assets/file${i}.png`,
    filename: `file${i}.png`,
    contentType: "image/png",
    sizeBytes: 100,
  }));
  const result = sanitizeBrandAssets(many);
  assert.equal(result.length, 5);
});

test("sanitizeBrandAssets truncates an oversized filename and drops an invalid sizeBytes", () => {
  const result = sanitizeBrandAssets([
    { path: "brand-assets/x.png", filename: "a".repeat(400), contentType: "image/png", sizeBytes: "not-a-number" },
  ]);
  assert.equal(result[0].filename.length, 255);
  assert.equal(result[0].sizeBytes, null);
});

test("sanitizeBrandAssets accepts every allowlisted content type", () => {
  const types = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "application/pdf"];
  for (const contentType of types) {
    const result = sanitizeBrandAssets([{ path: "brand-assets/f", filename: "f", contentType, sizeBytes: 1 }]);
    assert.equal(result.length, 1, `expected ${contentType} to be accepted`);
  }
});
