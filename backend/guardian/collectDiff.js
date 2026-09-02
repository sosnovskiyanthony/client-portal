// Builds the review input for the Guardian AI code reviewer: a git diff
// against a base ref, filtered to changed backend .js files and truncated
// to a size budget appropriate for qwen2.5:7b, plus a best-effort match of
// existing test files for "relevant tests" context. Never sends the whole
// repository to the model — see ai/guardianPrompt.js's MAX_DIFF_CHARS.
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const REPO_ROOT = path.join(__dirname, "..");
const DEFAULT_BASE_REF = "origin/main";

function run(args) {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
  } catch (err) {
    throw new Error(`git ${args.join(" ")} failed: ${err.message}`);
  }
}

function safeRun(args, fallback = "") {
  try {
    return run(args);
  } catch {
    return fallback;
  }
}

// Excludes node_modules and package-lock.json — noise, never something the
// reviewer should spend its limited context budget on. `git diff --name-only`
// reports paths relative to the actual repo root, which may nest this
// backend/ directory (e.g. "backend/services/runChat.js") — matching on
// path segments, not just a leading prefix, so a nested node_modules is
// still excluded correctly.
function isReviewable(filePath) {
  if (!filePath.endsWith(".js")) return false;
  const segments = filePath.split("/");
  if (segments.includes("node_modules")) return false;
  if (filePath.endsWith("package-lock.json")) return false;
  return true;
}

// Guesses at a corresponding test file by filename — a best-effort
// heuristic (this codebase's test/*.test.js files aren't required to mirror
// source paths 1:1), not a guarantee every changed file has a match.
function guessTestFile(changedFile) {
  const base = path.basename(changedFile, ".js");
  const candidates = [
    path.join(REPO_ROOT, "test", `${base}.test.js`),
    path.join(REPO_ROOT, "test", `${base}Ai.test.js`),
    path.join(REPO_ROOT, "test", `${base}Schema.test.js`),
    path.join(REPO_ROOT, "test", `${base}Integration.test.js`),
    path.join(REPO_ROOT, "test", `${base}PromptInjection.test.js`),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function collectDiff({ baseRef = DEFAULT_BASE_REF, headRef = "HEAD" } = {}) {
  // Falls back to comparing against the first commit when the base ref
  // doesn't exist locally (e.g. a shallow clone, or no "origin" remote in
  // this environment) — better to review something than to hard-fail.
  const baseExists = safeRun(["rev-parse", "--verify", baseRef]).trim().length > 0;
  const effectiveBase = baseExists ? baseRef : run(["rev-list", "--max-parents=0", headRef]).trim();

  const changedFilesRaw = safeRun(["diff", "--name-only", `${effectiveBase}...${headRef}`]);
  const changedFiles = changedFilesRaw
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter(isReviewable);

  if (changedFiles.length === 0) {
    return {
      baseRef: effectiveBase,
      headRef,
      changedFiles: [],
      diff: "",
      relevantTests: "",
      truncatedDiff: false,
    };
  }

  const diff = safeRun(["diff", `${effectiveBase}...${headRef}`, "--", ...changedFiles]);

  const testFiles = [...new Set(changedFiles.map(guessTestFile).filter(Boolean))];
  const relevantTests = testFiles
    .map((f) => {
      const rel = path.relative(REPO_ROOT, f);
      const content = fs.readFileSync(f, "utf8");
      return `--- ${rel} ---\n${content}`;
    })
    .join("\n\n");

  return {
    baseRef: effectiveBase,
    headRef,
    changedFiles,
    diff,
    relevantTests,
    truncatedDiff: false, // actual truncation happens in ai/guardianPrompt.js at prompt-build time
  };
}

module.exports = { collectDiff, isReviewable, guessTestFile };
