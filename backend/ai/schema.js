// Structured-output schema for the AI project analysis. Passed to
// Anthropic's messages.parse() via zodOutputFormat() — Claude's response is
// validated against this before it ever reaches the database or the admin
// dashboard, so a malformed model response fails loudly instead of storing
// garbage. Deliberately typed (arrays are arrays, objects are objects, enums
// for controlled vocabulary) rather than one giant free-text string.

const { z } = require("zod");

const RiskSchema = z.object({
  risk: z.string().describe("Short name for the risk, e.g. 'Unclear e-commerce scope'"),
  severity: z.enum(["low", "medium", "high"]),
  explanation: z.string().describe("Why this is a risk, grounded in what the client actually said"),
});

const ScopeRecommendationSchema = z.object({
  scope: z.enum(["small", "medium", "large", "complex_custom"]),
  reasoning: z.string(),
});

const TimelineRecommendationSchema = z.object({
  discovery: z.string(),
  design: z.string(),
  development: z.string(),
  qa_and_launch: z.string(),
});

const AnalysisSchema = z.object({
  project_summary: z.string().describe("Concise professional summary based only on the actual submission"),
  business_summary: z.string(),
  primary_goal: z.string(),
  secondary_goals: z.array(z.string()),
  target_audience: z.string(),
  recommended_website_type: z.string(),
  recommended_site_structure: z.string().describe("Information architecture / navigation recommendation, as prose"),
  recommended_pages: z.array(z.string()),
  required_features: z.array(z.string()).describe("Features the client explicitly asked for — facts, not AI opinion"),
  recommended_features: z.array(z.string()).describe("Features the AI believes would help — clearly separate from required_features"),
  technical_requirements: z.array(z.string()),
  cms_recommendation: z.string(),
  integrations: z.array(z.string()),
  seo_opportunities: z.array(z.string()).describe("No invented keyword volume, rankings, or traffic projections"),
  analytics_recommendations: z.array(z.string()),
  content_requirements: z.array(z.string()),
  brand_requirements: z.string(),
  ux_considerations: z.array(z.string()),
  accessibility_considerations: z.array(z.string()),
  performance_considerations: z.array(z.string()),
  security_considerations: z.array(z.string()),
  potential_risks: z.array(RiskSchema),
  missing_information: z.array(z.string()).describe("Use 'Unknown / needs clarification' phrasing where appropriate"),
  critical_questions: z.array(z.string()).describe("Questions that could materially affect scope, price, timeline, tech, design, integrations, or SEO"),
  nice_to_have_questions: z.array(z.string()),
  scope_recommendation: ScopeRecommendationSchema,
  complexity: z.enum(["low", "medium", "high"]),
  timeline_recommendation: TimelineRecommendationSchema,
  priority: z.enum(["low", "medium", "high"]),
  potential_additional_services: z.array(z.string()).describe("Only when the intake gives a legitimate reason — not a sales pitch"),
  internal_notes: z.array(z.string()).describe("Private observations for the business owner — never shown to the client"),
  confidence: z.number().min(0).max(1).describe(
    "Your confidence in this analysis, as a decimal fraction between 0.0 and 1.0 — e.g. 0.75, never a percentage like 75 or 75%"
  ),
});

module.exports = { AnalysisSchema };
