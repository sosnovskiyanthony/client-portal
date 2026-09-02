// Direct tests for guardian/sentryScrub.js's beforeSend hook — see
// instrument.js's own comment for why this exists (the 3 raw
// Sentry.captureException(err) call sites in server.js previously
// forwarded whatever a caught error's message/stack happened to contain,
// with zero scrubbing).
const test = require("node:test");
const assert = require("node:assert/strict");
const { scrubEvent, scrubString } = require("../guardian/sentryScrub");

test("redacts a Bearer token", () => {
  const result = scrubString("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature123");
  assert.ok(!result.includes("eyJhbGciOiJIUzI1NiJ9"));
  assert.match(result, /\[REDACTED\]/);
});

test("redacts a bare JWT-shaped string even without a Bearer prefix", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwicm9sZSI6ImFkbWluIn0.abcDEF123_-";
  const result = scrubString(`token dump: ${jwt}`);
  assert.ok(!result.includes(jwt));
});

test("redacts known provider API key prefixes", () => {
  assert.ok(!scrubString("re_1234567890abcdef").includes("1234567890abcdef"));
  assert.ok(!scrubString("sk-ant-api03-abcdefghijklmnop").includes("abcdefghijklmnop"));
  assert.ok(!scrubString("tvly-abcdefghijklmnop").includes("abcdefghijklmnop"));
});

test("redacts a Postgres connection string's embedded credentials", () => {
  const result = scrubString("connection failed: postgresql://appuser:sup3rsecret@db.internal:5432/prod");
  assert.ok(!result.includes("sup3rsecret"));
  assert.ok(!result.includes("appuser"));
});

test("redacts a Supabase signed URL's token query param but keeps the rest of the URL readable", () => {
  const result = scrubString("https://x.supabase.co/storage/v1/object/sign/brand-assets/foo.png?token=eyJhbGci.abc.def");
  assert.ok(!result.includes("eyJhbGci.abc.def"));
  assert.ok(result.includes("brand-assets/foo.png"), "the non-sensitive part of the URL should remain for debugging");
});

test("leaves ordinary error text completely untouched", () => {
  const message = "Cannot read properties of undefined (reading 'foo')";
  assert.equal(scrubString(message), message);
});

test("scrubEvent scrubs event.message, exception values, breadcrumbs, and extra", () => {
  const event = {
    message: "Failed with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
    exception: {
      values: [{ type: "Error", value: "re_secretkey1234567890" }],
    },
    breadcrumbs: [{ message: "tried postgresql://u:secretpassword@host/db" }],
    extra: { detail: "sk-ant-api03-shouldnotappearhere1234" },
  };
  const scrubbed = scrubEvent(event);
  assert.ok(!scrubbed.message.includes("eyJhbGciOiJIUzI1NiJ9"));
  assert.ok(!scrubbed.exception.values[0].value.includes("secretkey1234567890"));
  assert.ok(!scrubbed.breadcrumbs[0].message.includes("secretpassword"));
  assert.ok(!scrubbed.extra.detail.includes("shouldnotappearhere1234"));
});

test("scrubEvent strips Authorization/Cookie headers entirely if present on request data", () => {
  const event = {
    request: { headers: { Authorization: "Bearer real-token-here", "User-Agent": "curl/8.0", Cookie: "session=abc" } },
  };
  const scrubbed = scrubEvent(event);
  assert.equal(scrubbed.request.headers.Authorization, undefined);
  assert.equal(scrubbed.request.headers.Cookie, undefined);
  assert.equal(scrubbed.request.headers["User-Agent"], "curl/8.0", "non-sensitive headers must be preserved");
});

test("scrubEvent handles a minimal/empty event without throwing", () => {
  assert.deepEqual(scrubEvent({}), {});
  assert.equal(scrubEvent(null), null);
  assert.equal(scrubEvent(undefined), undefined);
});

test("errorController.js's already-allowlisted fields (message/stack/url) still pass through scrubEvent safely", () => {
  // Not a duplicate of test/clientError.test.js's own coverage — this
  // proves the two layers of privacy protection (an explicit field
  // allowlist at the controller, plus this pattern-based scrub at the
  // Sentry boundary) compose correctly rather than one undoing the other.
  const event = {
    exception: { values: [{ type: "Error", value: "TypeError: x is not a function" }] },
    extra: { url: "https://example.com/page.html", line: 10, col: 5, userAgent: "Mozilla/5.0" },
  };
  const scrubbed = scrubEvent(event);
  assert.equal(scrubbed.exception.values[0].value, "TypeError: x is not a function");
  assert.equal(scrubbed.extra.url, "https://example.com/page.html");
});
