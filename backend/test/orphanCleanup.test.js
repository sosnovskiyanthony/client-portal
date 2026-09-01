const test = require("node:test");
const assert = require("node:assert/strict");
const { filterOrphaned, MIN_AGE_MS } = require("../services/orphanCleanup");

const NOW = new Date("2026-06-01T00:00:00Z").getTime();
const OLD = new Date(NOW - MIN_AGE_MS - 60_000).toISOString(); // past the safety window
const RECENT = new Date(NOW - 60_000).toISOString(); // 1 minute old — well inside the window

test("filterOrphaned keeps a referenced file regardless of age", () => {
  const files = [{ path: "brand-assets/a.png", createdAt: OLD }];
  const referenced = new Set(["brand-assets/a.png"]);
  assert.deepEqual(filterOrphaned(files, referenced, NOW), []);
});

test("filterOrphaned drops an unreferenced file older than the safety window", () => {
  const files = [{ path: "brand-assets/a.png", createdAt: OLD }];
  const referenced = new Set();
  const result = filterOrphaned(files, referenced, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, "brand-assets/a.png");
});

test("filterOrphaned leaves an unreferenced but recent file alone (still might be mid-upload)", () => {
  const files = [{ path: "brand-assets/a.png", createdAt: RECENT }];
  const referenced = new Set();
  assert.deepEqual(filterOrphaned(files, referenced, NOW), []);
});

test("filterOrphaned treats a missing createdAt as old enough to remove", () => {
  const files = [{ path: "brand-assets/a.png", createdAt: null }];
  const referenced = new Set();
  const result = filterOrphaned(files, referenced, NOW);
  assert.equal(result.length, 1);
});

test("filterOrphaned handles a mix of referenced, old-orphaned, and recent-orphaned files", () => {
  const files = [
    { path: "brand-assets/referenced.png", createdAt: OLD },
    { path: "brand-assets/old-orphan.png", createdAt: OLD },
    { path: "brand-assets/recent-orphan.png", createdAt: RECENT },
  ];
  const referenced = new Set(["brand-assets/referenced.png"]);
  const result = filterOrphaned(files, referenced, NOW);
  assert.deepEqual(
    result.map((f) => f.path),
    ["brand-assets/old-orphan.png"]
  );
});

test("filterOrphaned returns an empty array when there are no files", () => {
  assert.deepEqual(filterOrphaned([], new Set(), NOW), []);
});
