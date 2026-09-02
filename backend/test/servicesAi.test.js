// Mirrors test/aiService.test.js's mocked-fetch pattern, for
// analyzeServicesSubmission — the sibling to analyzeSubmission for
// type: "services" submissions.
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

const VALID_SERVICES_RESULT = {
  project_summary: "s", target_audience: "a",
  required_features: [], recommended_features: [],
  recommendations: [],
  missing_information: [], critical_questions: [], nice_to_have_questions: [],
  scope_recommendation: { scope: "small", reasoning: "r" }, complexity: "low",
  timeline_recommendation: { discovery: "1w", design: "1w", development: "1w", qa_and_launch: "1w" },
  priority: "low", internal_notes: [], reasoning: [], confidence: 0.5,
};

test("rejects submission types other than 'services' without calling the provider", async () => {
  let fetchCalled = false;
  await withMockedFetch(
    async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ message: { content: "{}" } }) };
    },
    async () => {
      await assert.rejects(
        () => aiService.analyzeServicesSubmission({ type: "web-design", projectDetails: {} }),
        (err) => err instanceof AiAnalysisError && err.code === "unsupported_type"
      );
    }
  );
  assert.equal(fetchCalled, false, "the provider must never be called for the wrong submission type");
});

test("a well-formed response passes end-to-end with correct provider/model/promptVersion metadata", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(VALID_SERVICES_RESULT) } }) }),
    async () => {
      const outcome = await aiService.analyzeServicesSubmission({
        type: "services",
        projectDetails: { services: ["ai-integration"], aiIntegration: { aiGoal: "x", businessProblem: "y" } },
      });
      assert.equal(outcome.provider, "ollama");
      assert.ok(outcome.model);
      assert.ok(outcome.promptVersion);
      assert.equal(outcome.result.project_summary, "s");
    }
  );
});

test("malformed structured output (missing required fields) is rejected as invalid_schema, not silently stored", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ project_summary: "only this field" }) } }) }),
    async () => {
      await assert.rejects(
        () => aiService.analyzeServicesSubmission({ type: "services", projectDetails: { services: ["seo"], seo: {} } }),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_schema"
      );
    }
  );
});

test("normalizes an out-of-range top-level confidence (percentage instead of fraction)", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify({ ...VALID_SERVICES_RESULT, confidence: 85 }) } }) }),
    async () => {
      const outcome = await aiService.analyzeServicesSubmission({ type: "services", projectDetails: { services: ["seo"], seo: {} } });
      assert.equal(outcome.result.confidence, 0.85);
    }
  );
});

test("normalizes an out-of-range confidence inside a recommendation entry too", async () => {
  const withBadRecommendationConfidence = {
    ...VALID_SERVICES_RESULT,
    recommendations: [
      {
        feature: "X", service: "seo", origin: "suggested", why: "Y", evidence: "Z", expected_value: "W",
        priority: "low", confidence: 90,
      },
    ],
  };
  await withMockedFetch(
    async () => ({ ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(withBadRecommendationConfidence) } }) }),
    async () => {
      const outcome = await aiService.analyzeServicesSubmission({ type: "services", projectDetails: { services: ["seo"], seo: {} } });
      assert.equal(outcome.result.recommendations[0].confidence, 0.9);
    }
  );
});
