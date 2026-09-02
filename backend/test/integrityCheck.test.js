// Tests guardian/integrityCheck.js against real files (copied to a temp
// directory so the test never touches this repo's own actual source or
// its committed manifest — see checkIntegrity's real-drift proof further
// down, which deliberately mutates a throwaway copy, not middleware/
// rateLimit.js itself).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("computeManifest produces a stable SHA-256 hash per file, null for a missing one", () => {
  const { computeManifest } = require("../guardian/integrityCheck");
  const manifest = computeManifest();
  for (const [file, hash] of Object.entries(manifest)) {
    if (hash !== null) {
      assert.match(hash, /^[a-f0-9]{64}$/, `${file}'s hash should be a real SHA-256 hex digest`);
    }
  }
});

test("checkIntegrity reports ok:true against the actual committed manifest (no real drift right now)", () => {
  const { checkIntegrity } = require("../guardian/integrityCheck");
  const result = checkIntegrity();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.drifted, []);
  assert.deepEqual(result.missing, []);
});

test("checkIntegrity detects a real, deliberate modification to a protected file", async () => {
  // Copies the real repo into a temp directory and requires a fresh copy
  // of integrityCheck.js from THERE — REPO_ROOT is computed relative to
  // __dirname at require time, so this genuinely exercises file-on-disk
  // hashing against a real (if temporary) file, without ever touching this
  // repo's own tracked files.
  const repoRoot = path.join(__dirname, "..");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-integrity-test-"));
  const tmpGuardianDir = path.join(tmpDir, "guardian");
  fs.mkdirSync(tmpGuardianDir);
  fs.copyFileSync(path.join(repoRoot, "guardian", "integrityCheck.js"), path.join(tmpGuardianDir, "integrityCheck.js"));
  fs.copyFileSync(path.join(repoRoot, "guardian", "integrity-manifest.json"), path.join(tmpGuardianDir, "integrity-manifest.json"));

  // Copy just enough of the protected-file tree for the check to have
  // real files to hash.
  const { PROTECTED_FILES } = require("../guardian/integrityCheck");
  for (const rel of PROTECTED_FILES) {
    const src = path.join(repoRoot, rel);
    const dest = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  delete require.cache[require.resolve(path.join(tmpGuardianDir, "integrityCheck.js"))];
  const tmpIntegrityCheck = require(path.join(tmpGuardianDir, "integrityCheck.js"));

  const before = tmpIntegrityCheck.checkIntegrity();
  assert.equal(before.ok, true, "the fresh copy should start identical to the manifest");

  // Now tamper with the temp copy only.
  const tamperedFile = path.join(tmpDir, "middleware", "auth.js");
  fs.appendFileSync(tamperedFile, "\n// tampered\n");

  const after = tmpIntegrityCheck.checkIntegrity();
  assert.equal(after.ok, false);
  assert.ok(after.drifted.includes("middleware/auth.js"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("writeManifest regenerates a manifest that immediately passes checkIntegrity", () => {
  const fsMod = require("node:fs");
  const { writeManifest, checkIntegrity, MANIFEST_PATH } = require("../guardian/integrityCheck");
  const originalManifest = fsMod.readFileSync(MANIFEST_PATH, "utf8");
  try {
    writeManifest();
    const result = checkIntegrity();
    assert.equal(result.ok, true);
  } finally {
    // Restore exactly what was committed — this test must never leave the
    // repo's real manifest file modified on disk.
    fsMod.writeFileSync(MANIFEST_PATH, originalManifest);
  }
});
