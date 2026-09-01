const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeBrandAssets } = require("../controllers/intakeController");

// Realistic UUID-shaped paths matching exactly what
// services/storage.js's uploadBrandAssets ever generates
// (brand-assets/<uuid>[.ext]) — see lib/validators.js's BRAND_ASSET_PATH_RE.
const UUID_PNG = "brand-assets/550e8400-e29b-41d4-a716-446655440000.png";
const UUID_PDF = "brand-assets/6ba7b810-9dad-11d1-80b4-00c04fd430c8.pdf";

test("sanitizeBrandAssets returns an empty array for a non-array input", () => {
  assert.deepEqual(sanitizeBrandAssets("not-an-array"), []);
  assert.deepEqual(sanitizeBrandAssets(null), []);
  assert.deepEqual(sanitizeBrandAssets(undefined), []);
});

test("sanitizeBrandAssets keeps a well-formed, real-shaped entry", () => {
  const result = sanitizeBrandAssets([
    { path: UUID_PNG, filename: "logo.png", contentType: "image/png", sizeBytes: 5000 },
  ]);
  assert.deepEqual(result, [{ path: UUID_PNG, filename: "logo.png", contentType: "image/png", sizeBytes: 5000 }]);
});

test("sanitizeBrandAssets strips a path with the wrong prefix entirely", () => {
  const result = sanitizeBrandAssets([
    { path: "../etc/passwd", filename: "evil", contentType: "image/png", sizeBytes: 1 },
  ]);
  assert.deepEqual(result, []);
});

// Regression test for the real bug: a bare `path.startsWith("brand-assets/")`
// check is bypassable, because this string also starts with that prefix.
test("sanitizeBrandAssets strips a traversal sequence appended after a valid prefix", () => {
  const result = sanitizeBrandAssets([
    { path: "brand-assets/../../../etc/passwd", filename: "evil", contentType: "image/png", sizeBytes: 1 },
  ]);
  assert.deepEqual(result, []);
});

test("sanitizeBrandAssets strips a path that isn't UUID-shaped even with the right prefix", () => {
  const result = sanitizeBrandAssets([
    { path: "brand-assets/not-a-real-uuid.png", filename: "x.png", contentType: "image/png", sizeBytes: 1 },
    { path: "brand-assets/", filename: "x.png", contentType: "image/png", sizeBytes: 1 },
    { path: "brand-assets", filename: "x.png", contentType: "image/png", sizeBytes: 1 },
  ]);
  assert.deepEqual(result, []);
});

test("sanitizeBrandAssets strips a disallowed content type", () => {
  const result = sanitizeBrandAssets([
    { path: UUID_PNG, filename: "virus.exe", contentType: "application/x-msdownload", sizeBytes: 1 },
  ]);
  assert.deepEqual(result, []);
});

// SVG was removed from the allowlist deliberately (stored-XSS risk via
// direct-navigation "View" — see controllers/intakeController.js).
test("sanitizeBrandAssets rejects image/svg+xml", () => {
  const result = sanitizeBrandAssets([{ path: UUID_PNG, filename: "logo.svg", contentType: "image/svg+xml", sizeBytes: 1 }]);
  assert.deepEqual(result, []);
});

test("sanitizeBrandAssets drops non-object entries in the array", () => {
  const result = sanitizeBrandAssets([
    "not-an-object",
    42,
    null,
    { path: UUID_PDF, filename: "ok.pdf", contentType: "application/pdf", sizeBytes: 10 },
  ]);
  assert.deepEqual(result, [{ path: UUID_PDF, filename: "ok.pdf", contentType: "application/pdf", sizeBytes: 10 }]);
});

test("sanitizeBrandAssets caps the list at 5 entries", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    path: `brand-assets/${i}50e8400-e29b-41d4-a716-44665544000${i}.png`,
    filename: `file${i}.png`,
    contentType: "image/png",
    sizeBytes: 100,
  }));
  const result = sanitizeBrandAssets(many);
  assert.equal(result.length, 5);
});

test("sanitizeBrandAssets truncates an oversized filename and drops an invalid sizeBytes", () => {
  const result = sanitizeBrandAssets([
    { path: UUID_PNG, filename: "a".repeat(400), contentType: "image/png", sizeBytes: "not-a-number" },
  ]);
  assert.equal(result[0].filename.length, 255);
  assert.equal(result[0].sizeBytes, null);
});

test("sanitizeBrandAssets accepts every allowlisted content type", () => {
  const types = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
  for (const contentType of types) {
    const result = sanitizeBrandAssets([{ path: UUID_PNG, filename: "f", contentType, sizeBytes: 1 }]);
    assert.equal(result.length, 1, `expected ${contentType} to be accepted`);
  }
});
