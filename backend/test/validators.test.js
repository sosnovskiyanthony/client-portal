const test = require("node:test");
const assert = require("node:assert/strict");
const { BRAND_ASSET_PATH_RE } = require("../lib/validators");

const REAL_PATH = "brand-assets/550e8400-e29b-41d4-a716-446655440000.png";
const REAL_PATH_NO_EXT = "brand-assets/550e8400-e29b-41d4-a716-446655440000";

test("BRAND_ASSET_PATH_RE accepts a real uuid path with an extension", () => {
  assert.ok(BRAND_ASSET_PATH_RE.test(REAL_PATH));
});

test("BRAND_ASSET_PATH_RE accepts a real uuid path with no extension", () => {
  assert.ok(BRAND_ASSET_PATH_RE.test(REAL_PATH_NO_EXT));
});

test("BRAND_ASSET_PATH_RE rejects a traversal sequence appended after the valid prefix", () => {
  // This is the actual bug that shipped: a bare `.startsWith("brand-assets/")`
  // check returns true for this string too.
  assert.equal("brand-assets/../../../etc/passwd".startsWith("brand-assets/"), true);
  assert.equal(BRAND_ASSET_PATH_RE.test("brand-assets/../../../etc/passwd"), false);
});

test("BRAND_ASSET_PATH_RE rejects any embedded slash after the prefix", () => {
  assert.equal(BRAND_ASSET_PATH_RE.test(`brand-assets/sub/${REAL_PATH_NO_EXT.slice(13)}.png`), false);
});

test("BRAND_ASSET_PATH_RE rejects the wrong prefix", () => {
  assert.equal(BRAND_ASSET_PATH_RE.test(`other-bucket/550e8400-e29b-41d4-a716-446655440000.png`), false);
});

test("BRAND_ASSET_PATH_RE rejects a non-uuid filename even with the right prefix", () => {
  assert.equal(BRAND_ASSET_PATH_RE.test("brand-assets/not-a-uuid.png"), false);
  assert.equal(BRAND_ASSET_PATH_RE.test("brand-assets/"), false);
  assert.equal(BRAND_ASSET_PATH_RE.test("brand-assets"), false);
});

test("BRAND_ASSET_PATH_RE rejects an oversized extension", () => {
  assert.equal(BRAND_ASSET_PATH_RE.test(`${REAL_PATH_NO_EXT}.tenletters`), false);
});
