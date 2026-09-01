const test = require("node:test");
const assert = require("node:assert/strict");
const { buildEmailHtml } = require("../services/email");

test("buildEmailHtml renders a plain string field normally", () => {
  const html = buildEmailHtml(
    { id: 1, createdAt: "2026-01-01T00:00:00Z", projectDetails: { name: "Jordan Casey" } },
    "Contact"
  );
  assert.ok(html.includes("Jordan Casey"));
});

test("buildEmailHtml renders a plain string-array field joined with commas", () => {
  const html = buildEmailHtml(
    { id: 1, createdAt: "2026-01-01T00:00:00Z", projectDetails: { features: ["cms", "auth"] } },
    "Web Design"
  );
  assert.ok(html.includes("cms, auth"));
});

// Regression test: brandAssets is an array of {path, filename, ...} objects,
// not strings — the generic Array.isArray().join(", ") path used to render
// this as literal "[object Object]" in every new-submission notification
// email for a web-design lead that attached files.
test("buildEmailHtml renders brandAssets as filenames, not [object Object]", () => {
  const html = buildEmailHtml(
    {
      id: 1,
      createdAt: "2026-01-01T00:00:00Z",
      projectDetails: {
        brandAssets: [
          { path: "brand-assets/abc.png", filename: "logo.png", contentType: "image/png", sizeBytes: 100 },
          { path: "brand-assets/def.pdf", filename: "style-guide.pdf", contentType: "application/pdf", sizeBytes: 200 },
        ],
      },
    },
    "Web Design"
  );
  assert.ok(html.includes("logo.png, style-guide.pdf"));
  assert.ok(!html.includes("[object Object]"));
});

test("buildEmailHtml escapes HTML in field values", () => {
  const html = buildEmailHtml(
    { id: 1, createdAt: "2026-01-01T00:00:00Z", projectDetails: { message: "<script>alert(1)</script>" } },
    "Contact"
  );
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("buildEmailHtml omits fields that are null, undefined, or empty string", () => {
  const html = buildEmailHtml(
    { id: 1, createdAt: "2026-01-01T00:00:00Z", projectDetails: { a: null, b: undefined, c: "", d: "kept" } },
    "Contact"
  );
  assert.ok(html.includes("kept"));
  assert.ok(!html.includes(">a<"));
  assert.ok(!html.includes(">b<"));
  assert.ok(!html.includes(">c<"));
});
