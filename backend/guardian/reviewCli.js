#!/usr/bin/env node
// `npm run guardian:ai` — collects the current diff against a base ref and
// runs it through the Guardian AI reviewer (ai/aiService.js's
// reviewCodeChange). Advisory only: exits 0 by default even when the
// review finds problems or when Ollama is unreachable, so it never blocks a
// commit/push on its own — pass --strict to make a "fail" verdict exit
// non-zero (see the --strict section below for exactly what that changes).
"use strict";

const { collectDiff } = require("./collectDiff");
const aiService = require("../ai/aiService");

function parseArgs(argv) {
  const args = { strict: false, base: undefined, head: "HEAD" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--strict") args.strict = true;
    else if (argv[i] === "--base") args.base = argv[++i];
    else if (argv[i] === "--head") args.head = argv[++i];
  }
  return args;
}

function printReport(review) {
  const { result, provider, model, promptVersion } = review;
  console.log("\n=== BrindLeaf Guardian — AI Review ===");
  console.log(`Provider: ${provider}  Model: ${model}  Prompt: ${promptVersion}`);
  console.log(`Overall: ${result.overall.toUpperCase()}  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  console.log(`\n${result.summary}\n`);

  if (result.findings.length === 0) {
    console.log("Findings: none.");
  } else {
    console.log(`Findings (${result.findings.length}):`);
    for (const f of result.findings) {
      console.log(`  [${f.severity.toUpperCase()}] ${f.title}`);
      console.log(`    ${f.file}${f.line ? ":" + f.line : ""} — ${f.category}`);
      console.log(`    ${f.description}`);
      console.log(`    Evidence: ${f.evidence}`);
      console.log(`    Recommendation: ${f.recommendation}`);
    }
  }

  if (result.missing_tests.length > 0) {
    console.log(`\nMissing tests:`);
    result.missing_tests.forEach((t) => console.log(`  - ${t}`));
  }
  if (result.architecture_violations.length > 0) {
    console.log(`\nArchitecture violations:`);
    result.architecture_violations.forEach((v) => console.log(`  - ${v}`));
  }
  if (result.positive_observations.length > 0) {
    console.log(`\nPositive observations:`);
    result.positive_observations.forEach((p) => console.log(`  - ${p}`));
  }
  console.log("");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const collected = collectDiff({ baseRef: args.base, headRef: args.head });

  if (collected.changedFiles.length === 0) {
    console.log("AI REVIEW: nothing to review — no reviewable file changes against the base ref.");
    process.exit(0);
  }

  console.log(`Reviewing ${collected.changedFiles.length} changed file(s) against ${collected.baseRef}...${collected.headRef}:`);
  collected.changedFiles.forEach((f) => console.log(`  - ${f}`));

  let review;
  try {
    review = await aiService.reviewCodeChange(collected, {
      onProgress: (stage) => process.stderr.write(`[guardian:ai] ${stage}\n`),
    });
  } catch (err) {
    // Ollama unreachable, timed out, or any other AiAnalysisError — report
    // honestly and exit 0. Deterministic checks are authoritative; this
    // layer being unavailable must never look like a hard CI failure, and
    // must never hang (the underlying provider call already has its own
    // timeout — see ai/providers/ollamaProvider.js).
    console.log(`AI REVIEW: unavailable — ${err.code || "error"}: ${err.message}`);
    process.exit(0);
  }

  printReport(review);

  if (args.strict && review.result.overall === "fail") {
    console.error("guardian:ai --strict: AI review returned FAIL.");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("guardian:ai crashed unexpectedly:", err);
  // Still exit 0 (not 2/uncaught) — a crash in the advisory layer must not
  // read as a deterministic-gate failure to anything scripting around this.
  process.exit(0);
});
