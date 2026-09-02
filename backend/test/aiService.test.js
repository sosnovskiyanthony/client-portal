const test = require("node:test");
const assert = require("node:assert/strict");
const aiService = require("../ai/aiService");
const anthropicProvider = require("../ai/providers/anthropicProvider");
const { AiAnalysisError } = require("../ai/errors");
const { ndjsonSuccess } = require("./helpers/ollamaStream");

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

const VALID_RESULT = {
  project_summary: "s", business_summary: "s", primary_goal: "g", secondary_goals: [],
  target_audience: "a", recommended_website_type: "t", recommended_site_structure: "s",
  recommended_pages: [], required_features: [], recommended_features: [],
  technical_requirements: [], cms_recommendation: "c", integrations: [], seo_opportunities: [],
  analytics_recommendations: [], content_requirements: [], brand_requirements: "b",
  ux_considerations: [], accessibility_considerations: [], performance_considerations: [],
  security_considerations: [], potential_risks: [], missing_information: [],
  critical_questions: [], nice_to_have_questions: [],
  scope_recommendation: { scope: "small", reasoning: "r" }, complexity: "low",
  timeline_recommendation: { discovery: "1w", design: "1w", development: "1w", qa_and_launch: "1w" },
  priority: "low", potential_additional_services: [], internal_notes: [], reasoning: [], confidence: 0.5,
};

test("rejects submission types other than web-design without calling the provider", async () => {
  let fetchCalled = false;
  await withMockedFetch(
    async () => {
      fetchCalled = true;
      return { ok: true, status: 200, body: ndjsonSuccess("{}") };
    },
    async () => {
      await assert.rejects(
        () => aiService.analyzeSubmission({ type: "seo", projectDetails: {} }),
        (err) => err instanceof AiAnalysisError && err.code === "unsupported_type"
      );
    }
  );
  assert.equal(fetchCalled, false, "the provider must never be called for an unsupported submission type");
});

test("normalizes an out-of-range confidence (percentage instead of fraction) before validation", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, body: ndjsonSuccess(JSON.stringify({ ...VALID_RESULT, confidence: 85 })) }),
    async () => {
      const outcome = await aiService.analyzeSubmission({ type: "web-design", projectDetails: {} });
      assert.equal(outcome.result.confidence, 0.85);
    }
  );
});

test("a well-formed response passes end-to-end with correct provider/model/promptVersion metadata", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, body: ndjsonSuccess(JSON.stringify(VALID_RESULT)) }),
    async () => {
      const outcome = await aiService.analyzeSubmission({ type: "web-design", projectDetails: { goal: "brand" } });
      assert.equal(outcome.provider, "ollama");
      assert.ok(outcome.model);
      assert.ok(outcome.promptVersion);
      assert.equal(outcome.result.primary_goal, "g");
    }
  );
});

test("malformed structured output (missing required fields) is rejected as invalid_schema, not silently stored", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, body: ndjsonSuccess(JSON.stringify({ project_summary: "only this field" })) }),
    async () => {
      await assert.rejects(
        () => aiService.analyzeSubmission({ type: "web-design", projectDetails: {} }),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_schema"
      );
    }
  );
});

test("Anthropic provider (dormant, opt-in): missing ANTHROPIC_API_KEY fails fast with missing_api_key, no network call", async () => {
  // ANTHROPIC_API_KEY is not set in this test environment — this is the
  // real, default-dormant state of the Anthropic provider (see config/env.js).
  await assert.rejects(
    () => anthropicProvider.generateStructuredAnalysis({
      systemPrompt: "sys",
      userMessage: "msg",
      zodSchema: require("../ai/schema").AnalysisSchema,
      model: "claude-opus-5",
    }),
    (err) => err instanceof AiAnalysisError && err.code === "missing_api_key"
  );
});
