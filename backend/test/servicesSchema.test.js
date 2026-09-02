const test = require("node:test");
const assert = require("node:assert/strict");
const { ServicesAnalysisSchema } = require("../ai/servicesSchema");
const { z } = require("zod");

const BASE = {
  project_summary: "A local bakery wants a new site plus an AI-powered ordering assistant.",
  target_audience: "Local customers ordering online",
  required_features: ["Online ordering"],
  recommended_features: ["Loyalty program"],
  recommendations: [
    {
      feature: "Order-status chatbot",
      service: "ai-integration",
      origin: "suggested",
      why: "The client mentioned spending hours answering 'where's my order' messages.",
      evidence: "businessProblem field: 'constant order status questions'",
      expected_value: "Frees up staff time during peak hours",
      priority: "high",
      confidence: 0.8,
    },
  ],
  missing_information: [],
  critical_questions: ["What's the budget range?"],
  nice_to_have_questions: [],
  scope_recommendation: { scope: "medium", reasoning: "Two combined services, moderate complexity." },
  complexity: "medium",
  timeline_recommendation: { discovery: "1 week", design: "2 weeks", development: "3 weeks", qa_and_launch: "1 week" },
  priority: "high",
  internal_notes: [],
  reasoning: ["Classified priority as high because the client described daily manual order-status replies."],
  confidence: 0.75,
};

test("schema accepts a valid multi-service analysis with two populated per-service sections", () => {
  const withSections = {
    ...BASE,
    web_design_analysis: {
      recommended_website_type: "Marketing + online ordering",
      recommended_site_structure: "Home, Menu, Order, About, Contact",
      recommended_pages: ["Home", "Menu", "Order"],
      cms_recommendation: "Lightweight CMS",
      ux_considerations: ["Clear ordering flow"],
      accessibility_considerations: ["Alt text on menu images"],
      brand_requirements: "Needs expansion",
    },
    ai_integration_analysis: {
      ai_opportunity: "Automate order-status replies",
      recommended_approach: "A simple assistant tied to the order system",
      integration_requirements: ["Order system API"],
      data_considerations: "Order records only",
      privacy_security_considerations: ["No payment data exposed to the assistant"],
      human_in_the_loop_considerations: "Escalate anything unusual to staff",
      operational_considerations: "Low ongoing cost given expected volume",
      risks: [{ risk: "Order system has no API yet", severity: "medium", explanation: "Would need to be built first." }],
    },
  };
  const result = ServicesAnalysisSchema.safeParse(withSections);
  assert.equal(result.success, true);
});

test("schema accepts an analysis with zero recommendations — an honest empty answer, not required to pad", () => {
  const result = ServicesAnalysisSchema.safeParse({ ...BASE, recommendations: [] });
  assert.equal(result.success, true);
});

test("schema accepts an analysis with no per-service sections at all (none were selected/relevant)", () => {
  const result = ServicesAnalysisSchema.safeParse(BASE);
  assert.equal(result.success, true);
});

test("schema rejects a recommendation missing 'origin' (requested vs suggested must always be explicit)", () => {
  const bad = {
    ...BASE,
    recommendations: [
      {
        feature: "X",
        service: "seo",
        // origin missing
        why: "Y",
        evidence: "Z",
        expected_value: "W",
        priority: "low",
        confidence: 0.5,
      },
    ],
  };
  const result = ServicesAnalysisSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("schema rejects an invalid 'service' value on a recommendation", () => {
  const bad = {
    ...BASE,
    recommendations: [{ ...BASE.recommendations[0], service: "not-a-real-service" }],
  };
  const result = ServicesAnalysisSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("schema rejects an invalid 'origin' value (must be exactly requested or suggested)", () => {
  const bad = {
    ...BASE,
    recommendations: [{ ...BASE.recommendations[0], origin: "maybe" }],
  };
  const result = ServicesAnalysisSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("schema rejects a missing required top-level field", () => {
  const { project_summary, ...missing } = BASE;
  const result = ServicesAnalysisSchema.safeParse(missing);
  assert.equal(result.success, false);
});

test("schema produces a valid JSON Schema for structured-output use (Ollama format field)", () => {
  const jsonSchema = z.toJSONSchema(ServicesAnalysisSchema);
  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties.recommendations);
  assert.equal(jsonSchema.properties.recommendations.type, "array");
});
