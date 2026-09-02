// Production code integrity tripwire — see guardian/README.md's "Production
// code integrity" section. SHA-256 hashes of a fixed list of security-
// critical files, compared against a manifest committed to the repo
// (guardian/integrity-manifest.json). This detects unexpected drift
// between what's actually on disk and what was deliberately shipped — a
// tampered deploy pipeline, a supply-chain issue, a file modified after
// the fact — NOT a defense against a sophisticated attacker who also
// updates the manifest. It's a tripwire, not a guarantee; stated plainly
// rather than oversold.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO_ROOT = path.join(__dirname, "..");
const MANIFEST_PATH = path.join(__dirname, "integrity-manifest.json");

// Deliberately the files whose compromise would actually matter for AI
// safety/security, not the whole repo — the AI control plane itself, the
// AI service chokepoint, the provider that runs the tool-calling loop, and
// the app's own auth/rate-limiting/security-config surface. Extend this
// list only for a file that would genuinely be a meaningful target.
const PROTECTED_FILES = [
  "guardian/aiControl.js",
  "guardian/circuitBreaker.js",
  "guardian/securityEvents.js",
  "guardian/aiCapabilities.js",
  "guardian/rules.js",
  "guardian/sentryScrub.js",
  "ai/aiService.js",
  "ai/providers/ollamaProvider.js",
  "server.js",
  "instrument.js",
  "middleware/auth.js",
  "middleware/rateLimit.js",
  "config/env.js",
  "package.json",
];

function hashFile(relativePath) {
  const fullPath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  const contents = fs.readFileSync(fullPath);
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function computeManifest() {
  const manifest = {};
  for (const file of PROTECTED_FILES) {
    manifest[file] = hashFile(file);
  }
  return manifest;
}

function loadCommittedManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function writeManifest() {
  const manifest = computeManifest();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

// Returns { ok, drifted, missing, extra } — never throws for a normal
// mismatch (that's the expected "found a problem" outcome, not an error).
function checkIntegrity() {
  const committed = loadCommittedManifest();
  if (!committed) {
    return { ok: false, error: "No committed manifest found — run `npm run guardian:integrity:update` first.", drifted: [], missing: [], extra: [] };
  }

  const current = computeManifest();
  const drifted = [];
  const missing = [];

  for (const file of Object.keys(committed)) {
    const currentHash = current[file];
    if (currentHash === null) {
      missing.push(file);
    } else if (currentHash !== committed[file]) {
      drifted.push(file);
    }
  }

  // A file present in PROTECTED_FILES but absent from the committed
  // manifest means the list changed without regenerating — worth flagging
  // the same way as drift, since it means the manifest is stale.
  const extra = Object.keys(current).filter((f) => !(f in committed));

  return { ok: drifted.length === 0 && missing.length === 0 && extra.length === 0, drifted, missing, extra };
}

module.exports = { checkIntegrity, computeManifest, writeManifest, PROTECTED_FILES, MANIFEST_PATH };
