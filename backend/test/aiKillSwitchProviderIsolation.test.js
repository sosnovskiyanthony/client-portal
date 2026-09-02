// Proves the actual, end-to-end guarantee the kill switch exists for:
// when AI is DISABLED or LOCKDOWN, the real provider (Ollama/Anthropic)
// is never reached at all — not "assertAiAllowed throws in isolation"
// (already covered directly in test/aiControl.test.js), but "a real
// aiService.* call with a mocked fetch never lets that fetch fire."
// Mirrors test/servicesAi.test.js's mocked-fetch pattern.
const test = require("node:test");
const assert = require("node:assert/strict");
const { pool } = require("../config/database");
const aiService = require("../ai/aiService");
const aiControl = require("../guardian/aiControl");
const { AiAnalysisError } = require("../ai/errors");

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

async function resetControlState() {
  await pool.query("DELETE FROM security_events");
  await pool.query("DELETE FROM ai_control_state WHERE id > 1");
  await pool.query("UPDATE ai_control_state SET state = 'ENABLED', reason = 'test reset', source = 'system' WHERE id = 1");
}

test.beforeEach(resetControlState);
test.afterEach(resetControlState);
test.after(() => pool.end());

const VALID_RESULT = {
  project_summary: "s", business_summary: "b", primary_goal: "g", secondary_goals: [],
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

test("while ENABLED, a real aiService call reaches the provider (sanity check the mock itself works)", async () => {
  let fetchCalled = false;
  await withMockedFetch(
    async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(VALID_RESULT) } }) };
    },
    async () => {
      await aiService.analyzeSubmission({
        type: "web-design",
        projectDetails: { goal: "brand", summary: "x", brandStatus: "established", features: [], contentReadiness: "ready", timeline: "2-4-weeks" },
      });
    }
  );
  assert.equal(fetchCalled, true);
});

test("while DISABLED, analyzeSubmission rejects WITHOUT the provider ever being called", async () => {
  await aiControl.setAiState({ state: "DISABLED", reason: "test", source: "admin" });
  let fetchCalled = false;
  await withMockedFetch(
    async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(VALID_RESULT) } }) };
    },
    async () => {
      await assert.rejects(
        () => aiService.analyzeSubmission({
          type: "web-design",
          projectDetails: { goal: "brand", summary: "x", brandStatus: "established", features: [], contentReadiness: "ready", timeline: "2-4-weeks" },
        }),
        (err) => err instanceof AiAnalysisError && err.code === "ai_disabled"
      );
    }
  );
  assert.equal(fetchCalled, false, "the provider must never be reached while AI is disabled");
});

test("while LOCKDOWN, chatReply rejects WITHOUT the provider ever being called", async () => {
  await aiControl.setAiState({ state: "LOCKDOWN", reason: "test", source: "admin" });
  let fetchCalled = false;
  await withMockedFetch(
    async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ message: { content: "hi" } }) };
    },
    async () => {
      await assert.rejects(
        () => aiService.chatReply({ sanitizedIntake: {}, analysisResult: null, history: [], userMessage: "hi" }),
        (err) => err instanceof AiAnalysisError && err.code === "ai_lockdown"
      );
    }
  );
  assert.equal(fetchCalled, false, "the provider must never be reached while AI is locked down");
});

test("while LOCKDOWN, reviewCodeChange (the Guardian AI reviewer itself) also rejects without calling the provider", async () => {
  await aiControl.setAiState({ state: "LOCKDOWN", reason: "test", source: "admin" });
  let fetchCalled = false;
  await withMockedFetch(
    async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ message: { content: "{}" } }) };
    },
    async () => {
      await assert.rejects(
        () => aiService.reviewCodeChange({ diff: "x", changedFiles: ["a.js"], relevantTests: "" }),
        (err) => err instanceof AiAnalysisError && err.code === "ai_lockdown"
      );
    }
  );
  assert.equal(fetchCalled, false, "even Guardian's own AI reviewer must respect the kill switch");
});

test("while DISABLED, chatReplyWithResearch (the tool-calling path that bypasses PROVIDERS) also rejects without calling the provider", async () => {
  await aiControl.setAiState({ state: "DISABLED", reason: "test", source: "admin" });
  let fetchCalled = false;
  await withMockedFetch(
    async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ message: { content: "hi" } }) };
    },
    async () => {
      await assert.rejects(
        () => aiService.chatReplyWithResearch({ sanitizedIntake: {}, analysisResult: null, history: [], userMessage: "hi" }),
        (err) => err instanceof AiAnalysisError && err.code === "ai_disabled"
      );
    }
  );
  assert.equal(fetchCalled, false, "the hardcoded-provider tool-calling path must also respect the kill switch");
});

test("re-enabling makes the provider reachable again", async () => {
  await aiControl.setAiState({ state: "DISABLED", reason: "test", source: "admin" });
  await aiControl.setAiState({ state: "ENABLED", reason: "test done", source: "admin" });
  let fetchCalled = false;
  await withMockedFetch(
    async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({ message: { content: JSON.stringify(VALID_RESULT) } }) };
    },
    async () => {
      await aiService.analyzeSubmission({
        type: "web-design",
        projectDetails: { goal: "brand", summary: "x", brandStatus: "established", features: [], contentReadiness: "ready", timeline: "2-4-weeks" },
      });
    }
  );
  assert.equal(fetchCalled, true);
});
