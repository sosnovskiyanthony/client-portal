const test = require("node:test");
const assert = require("node:assert/strict");
const { AnalysisSchema } = require("../ai/schema");

const VALID_ANALYSIS = {
  project_summary: "A lead-gen site for a local roofing company.",
  business_summary: "Small commercial roofing company.",
  primary_goal: "Lead Generation / Sales",
  secondary_goals: ["Build trust with homeowners"],
  target_audience: "Local homeowners and small businesses",
  recommended_website_type: "Marketing / lead-generation site",
  recommended_site_structure: "Home, Services, About, Contact",
  recommended_pages: ["Home", "Services", "About", "Contact"],
  required_features: ["CMS Integration"],
  recommended_features: ["Analytics"],
  technical_requirements: ["CMS"],
  cms_recommendation: "Headless CMS",
  integrations: ["CRM"],
  seo_opportunities: ["Local SEO"],
  analytics_recommendations: ["GA4"],
  content_requirements: ["Service page copy"],
  brand_requirements: "Needs expansion",
  ux_considerations: ["Clear CTAs"],
  accessibility_considerations: ["Alt text on images"],
  performance_considerations: ["Optimize images"],
  security_considerations: ["Form validation"],
  potential_risks: [{ risk: "Tight timeline", severity: "high", explanation: "Client wants 2-4 weeks." }],
  missing_information: ["Budget range"],
  critical_questions: ["What's the budget?"],
  nice_to_have_questions: ["Preferred color palette?"],
  scope_recommendation: { scope: "medium", reasoning: "Moderate feature set." },
  complexity: "medium",
  timeline_recommendation: { discovery: "1 week", design: "2 weeks", development: "3 weeks", qa_and_launch: "1 week" },
  priority: "high",
  potential_additional_services: ["SEO Consultation"],
  internal_notes: ["Client seems price-sensitive"],
  confidence: 0.8,
};

test("schema accepts a fully valid analysis object", () => {
  const result = AnalysisSchema.safeParse(VALID_ANALYSIS);
  assert.equal(result.success, true);
});

test("schema rejects a missing required field", () => {
  const { project_summary, ...missingSummary } = VALID_ANALYSIS;
  const result = AnalysisSchema.safeParse(missingSummary);
  assert.equal(result.success, false);
});

test("schema rejects an invalid enum value (malformed AI response)", () => {
  const bad = { ...VALID_ANALYSIS, complexity: "extremely-high" };
  const result = AnalysisSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("schema rejects confidence out of range", () => {
  const bad = { ...VALID_ANALYSIS, confidence: 85 };
  const result = AnalysisSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("schema rejects a string where an array is expected (not everything is a giant string)", () => {
  const bad = { ...VALID_ANALYSIS, required_features: "CMS Integration, Analytics" };
  const result = AnalysisSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("schema rejects a malformed nested risk object", () => {
  const bad = { ...VALID_ANALYSIS, potential_risks: [{ risk: "X", severity: "catastrophic", explanation: "Y" }] };
  const result = AnalysisSchema.safeParse(bad);
  assert.equal(result.success, false);
});

test("schema produces a valid JSON Schema for structured-output use (Ollama format field)", () => {
  const { z } = require("zod");
  const jsonSchema = z.toJSONSchema(AnalysisSchema);
  assert.equal(jsonSchema.type, "object");
  assert.ok(jsonSchema.properties.potential_risks);
  assert.equal(jsonSchema.properties.potential_risks.type, "array");
});
