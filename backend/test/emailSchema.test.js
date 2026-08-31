const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { EmailDraftSchema } = require("../ai/emailSchema");
const { buildEmailContext } = require("../ai/emailPrompt");

test("EmailDraftSchema accepts a valid subject+body pair", () => {
  const result = EmailDraftSchema.safeParse({ subject: "Following up", body: "Hi there,\n\nThanks for reaching out." });
  assert.equal(result.success, true);
});

test("EmailDraftSchema rejects a missing body", () => {
  const result = EmailDraftSchema.safeParse({ subject: "Following up" });
  assert.equal(result.success, false);
});

test("EmailDraftSchema rejects an empty subject", () => {
  const result = EmailDraftSchema.safeParse({ subject: "", body: "Hi there." });
  assert.equal(result.success, false);
});

test("EmailDraftSchema produces a valid JSON Schema for structured-output use", () => {
  const jsonSchema = z.toJSONSchema(EmailDraftSchema);
  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties.subject);
  assert.ok(jsonSchema.properties.body);
});

const ANALYSIS_RESULT = {
  project_summary: "A lead-gen site for a local landscaping company.",
  scope_recommendation: { scope: "medium", reasoning: "Moderate feature set." },
  timeline_recommendation: { discovery: "1 week", design: "1 week", development: "2 weeks", qa_and_launch: "1 week" },
  required_features: ["CMS Integration"],
  recommended_features: ["Analytics"],
  critical_questions: ["What's the budget?"],
  // Deliberately included here to prove buildEmailContext excludes them below.
  internal_notes: ["Client seems price-sensitive — negotiate carefully."],
  potential_risks: [{ risk: "Tight timeline", severity: "high", explanation: "Client wants 2-4 weeks." }],
  missing_information: ["Budget range"],
  confidence: 0.8,
  priority: "high",
  complexity: "medium",
};

test("buildEmailContext includes the client's real name (unlike the internal analysis prompt)", () => {
  const ctx = buildEmailContext(
    { clientName: "Priya Landscaping", projectDetails: {} },
    { status: "completed", result: ANALYSIS_RESULT }
  );
  assert.equal(ctx.client_first_name, "Priya");
  assert.equal(ctx.client_full_name, "Priya Landscaping");
});

test("buildEmailContext handles a missing client name without throwing", () => {
  const ctx = buildEmailContext({ clientName: null, projectDetails: {} }, { status: "completed", result: ANALYSIS_RESULT });
  assert.equal(ctx.client_first_name, null);
  assert.equal(ctx.client_full_name, null);
});

test("buildEmailContext never forwards internal-only analysis fields (internal_notes, potential_risks, missing_information, confidence, priority, complexity)", () => {
  const ctx = buildEmailContext(
    { clientName: "Priya Landscaping", projectDetails: {} },
    { status: "completed", result: ANALYSIS_RESULT }
  );
  const serialized = JSON.stringify(ctx);
  assert.ok(!serialized.includes("price-sensitive"), "internal_notes content must never reach the email-drafting prompt");
  assert.ok(!("internal_notes" in ctx));
  assert.ok(!("potential_risks" in ctx));
  assert.ok(!("missing_information" in ctx));
  assert.ok(!("confidence" in ctx));
  assert.ok(!("priority" in ctx));
  assert.ok(!("complexity" in ctx));
});

test("buildEmailContext carries the useful, client-safe analysis fields through", () => {
  const ctx = buildEmailContext(
    { clientName: "Priya Landscaping", projectDetails: {} },
    { status: "completed", result: ANALYSIS_RESULT }
  );
  assert.equal(ctx.project_summary, ANALYSIS_RESULT.project_summary);
  assert.deepEqual(ctx.scope_recommendation, ANALYSIS_RESULT.scope_recommendation);
  assert.deepEqual(ctx.open_questions, ANALYSIS_RESULT.critical_questions);
  assert.deepEqual(ctx.required_features, ANALYSIS_RESULT.required_features);
  assert.deepEqual(ctx.recommended_features, ANALYSIS_RESULT.recommended_features);
});
