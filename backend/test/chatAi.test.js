// Mirrors test/aiService.test.js's mocked-fetch pattern, for the two new
// AI chat functions: analyzeRawText (reuses AnalysisSchema/SYSTEM_PROMPT —
// the "paste client text, get a real analysis" action) and chatReply (free
// text, multi-turn — the actual conversation).
const test = require("node:test");
const assert = require("node:assert/strict");
const aiService = require("../ai/aiService");
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

test("analyzeRawText: a well-formed response passes end-to-end, reusing the same schema as analyzeSubmission", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, body: ndjsonSuccess(JSON.stringify(VALID_RESULT)) }),
    async () => {
      const outcome = await aiService.analyzeRawText("Client emailed asking about a new site.");
      assert.equal(outcome.provider, "ollama");
      assert.ok(outcome.model);
      assert.ok(outcome.promptVersion);
      assert.equal(outcome.result.primary_goal, "g");
    }
  );
});

test("analyzeRawText: malformed structured output is rejected as invalid_schema, not silently stored", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, body: ndjsonSuccess(JSON.stringify({ project_summary: "only this field" })) }),
    async () => {
      await assert.rejects(
        () => aiService.analyzeRawText("some pasted text"),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_schema"
      );
    }
  );
});

test("analyzeRawText: normalizes an out-of-range confidence the same way analyzeSubmission does", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, body: ndjsonSuccess(JSON.stringify({ ...VALID_RESULT, confidence: 90 })) }),
    async () => {
      const outcome = await aiService.analyzeRawText("some pasted text");
      assert.equal(outcome.result.confidence, 0.9);
    }
  );
});

test("chatReply: a well-formed free-text response passes through, with the context message sent as the first turn", async () => {
  let capturedBody;
  await withMockedFetch(
    async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, body: ndjsonSuccess("  Here's my take on that.  ") };
    },
    async () => {
      const outcome = await aiService.chatReply({
        sanitizedIntake: { business_summary: "A bakery site." },
        analysisResult: { project_summary: "A lead-gen site for a bakery." },
        history: [],
        userMessage: "Why did you rate this medium complexity?",
      });
      assert.equal(outcome.provider, "ollama");
      assert.ok(outcome.model);
      assert.ok(outcome.promptVersion);
      // Trimmed, not the raw padded string from the mocked response.
      assert.equal(outcome.text, "Here's my take on that.");
    }
  );

  // system, context, fake ack, then the real user turn — no "format" field
  // (free-text, not schema-constrained, unlike generateStructuredAnalysis).
  assert.equal(capturedBody.messages[0].role, "system");
  assert.ok(capturedBody.messages.some((m) => m.role === "user" && m.content.includes("<SUBMISSION_CONTEXT>")));
  assert.equal(capturedBody.messages[capturedBody.messages.length - 1].content, "Why did you rate this medium complexity?");
  assert.equal(capturedBody.format, undefined);
});

test("chatReply: prior turns are replayed as user/assistant messages, mapped from admin/assistant roles", async () => {
  let capturedBody;
  await withMockedFetch(
    async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, body: ndjsonSuccess("ok") };
    },
    async () => {
      await aiService.chatReply({
        sanitizedIntake: {},
        analysisResult: null,
        history: [
          { role: "admin", content: "First question" },
          { role: "assistant", content: "First answer" },
        ],
        userMessage: "Follow-up",
      });
    }
  );

  const roles = capturedBody.messages.map((m) => m.role);
  const contents = capturedBody.messages.map((m) => m.content);
  assert.ok(contents.includes("First question"));
  assert.ok(contents.includes("First answer"));
  assert.equal(roles[roles.length - 1], "user");
});

test("updateAnalysisFromConversation: a well-formed revision passes end-to-end, reusing AnalysisSchema", async () => {
  let capturedBody;
  await withMockedFetch(
    async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200, body: ndjsonSuccess(JSON.stringify({ ...VALID_RESULT, project_summary: "Revised summary" })) };
    },
    async () => {
      const outcome = await aiService.updateAnalysisFromConversation(
        VALID_RESULT,
        { business_summary: "A bakery site." },
        [{ role: "admin", content: "Actually the client wants e-commerce, not just lead-gen." }]
      );
      assert.equal(outcome.provider, "ollama");
      assert.ok(outcome.model);
      assert.ok(outcome.promptVersion);
      assert.equal(outcome.result.project_summary, "Revised summary");
    }
  );

  // No "format" field would be wrong here — this DOES reuse the schema-
  // constrained path (generateStructuredAnalysis), unlike chatReply.
  assert.ok(capturedBody.format);
  const userMessage = capturedBody.messages[1].content;
  assert.ok(userMessage.includes("<SUBMISSION_DATA>"));
  assert.ok(userMessage.includes("<CURRENT_ANALYSIS>"));
  assert.ok(userMessage.includes("<CONVERSATION>"));
});

test("updateAnalysisFromConversation: malformed structured output is rejected as invalid_schema", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, body: ndjsonSuccess(JSON.stringify({ project_summary: "only this field" })) }),
    async () => {
      await assert.rejects(
        () => aiService.updateAnalysisFromConversation(VALID_RESULT, {}, []),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_schema"
      );
    }
  );
});

test("chatReply: an empty response from Ollama is classified as invalid_json, not silently returned as a reply", async () => {
  await withMockedFetch(
    async () => ({ ok: true, status: 200, body: ndjsonSuccess("") }),
    async () => {
      await assert.rejects(
        () =>
          aiService.chatReply({
            sanitizedIntake: {},
            analysisResult: null,
            history: [],
            userMessage: "Hello",
          }),
        (err) => err instanceof AiAnalysisError && err.code === "invalid_json"
      );
    }
  );
});
