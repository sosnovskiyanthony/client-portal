// Mirrors test/servicesAi.test.js's mocked-fetch pattern, for
// aiService.reviewCodeChange — Guardian's AI code reviewer.
const test = require("node:test");
const assert = require("node:assert/strict");
const aiService = require("../ai/aiService");
const { AiAnalysisError } = require("../ai/errors");

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const VALID_REVIEW_RESULT = {
  overall: "pass",
  confidence: 0.7,
  findings: [],
  missing_tests: [],
  architecture_violations: [],
  positive_observations: [],
  summary: "Looks fine.",
};

const SAMPLE_INPUT = {
  diff: "--- a/foo.js\n+++ b/foo.js\n@@ -1 +1 @@\n-old\n+new",
  changedFiles: ["foo.js"],
  relevantTests: "",
  baseRef: "origin/main",
  headRef: "HEAD",
};

test("a well-formed response passes end-to-end with correct provider/model/promptVersion metadata", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(VALID_REVIEW_RESULT) } }) }),
    async () => {
      const outcome = await aiService.reviewCodeChange(SAMPLE_INPUT);
      assert.equal(outcome.provider, "ollama");
      assert.ok(outcome.model);
      assert.ok(outcome.promptVersion);
      assert.equal(outcome.result.overall, "pass");
    }
  );
});

test("malformed structured output (missing required fields) is rejected as invalid_schema, not silently stored", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ overall: "pass" }) } }) }),
    async () => {
      await assert.rejects(
        () => aiService.reviewCodeChange(SAMPLE_INPUT),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_schema"
      );
    }
  );
});

test("a schema-invalid 'overall' value is rejected as invalid_schema", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ ...VALID_REVIEW_RESULT, overall: "definitely fine trust me" }) } }) }),
    async () => {
      await assert.rejects(
        () => aiService.reviewCodeChange(SAMPLE_INPUT),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_schema"
      );
    }
  );
});

test("normalizes an out-of-range confidence (percentage instead of fraction)", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ ...VALID_REVIEW_RESULT, confidence: 85 }) } }) }),
    async () => {
      const outcome = await aiService.reviewCodeChange(SAMPLE_INPUT);
      assert.equal(outcome.result.confidence, 0.85);
    }
  );
});

test("a network failure (Ollama unreachable) surfaces as an AiAnalysisError, never hangs or crashes the process", async () => {
  await withMockedFetch(
    async () => {
      throw new Error("fetch failed");
    },
    async () => {
      await assert.rejects(() => aiService.reviewCodeChange(SAMPLE_INPUT), (err) => err instanceof AiAnalysisError);
    }
  );
});
