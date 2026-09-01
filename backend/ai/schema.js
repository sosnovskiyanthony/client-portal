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

const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
});

// Additive — introduced alongside the existing seo_opportunities/
// recommended_features string-array fields below, not a replacement for
// them. Every stored analysis generated before this schema change is
// missing seo_recommendations/feature_recommendations entirely; both
// default to [] specifically so a response that never populates them
// (SEO or new features genuinely weren't relevant for this client) still
// validates — an empty array here is a real, meaningful "not applicable
// for this client" answer, not a missing field.
const SeoRecommendationSchema = z.object({
  recommendation: z.string().describe("What should be done"),
  why: z.string().describe("Why this makes sense for this specific client — not generic SEO advice"),
  expected_value: z.string().describe("What problem/opportunity this addresses"),
  evidence: z.string().describe("What in the submission (or research, if any) supports this"),
  priority: z.enum(["low", "medium", "high"]),
  category: z
    .enum([
      "on_page",
      "technical",
      "local",
      "structured_data",
      "content",
      "internal_linking",
      "conversion",
      "search_intent",
      "keyword_topic",
      "other",
    ])
    .optional(),
  // Only present when this specific recommendation was backed by external
  // research (see ai/researchTool.js) — absent for a recommendation drawn
  // purely from the submission and general expertise.
  sources: z.array(SourceSchema).optional(),
});

const FeatureRecommendationSchema = z.object({
  feature: z.string().describe("What should be built"),
  problem_solved: z.string().describe("What client/user problem this addresses"),
  reasoning: z.string().describe("Why this feature is appropriate for this specific client — not because it's common"),
  expected_impact: z.string().describe("What outcome this could improve"),
  priority: z.enum(["low", "medium", "high"]),
  dependencies_considerations: z.string().optional().describe("Anything to consider before implementing it"),
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
  feature_recommendations: z
    .array(FeatureRecommendationSchema)
    .optional()
    .describe(
      "Detailed feature recommendations, grounded in this client's actual goals/audience/business model — never a generic list of common website features."
    ),
  technical_requirements: z.array(z.string()),
  cms_recommendation: z.string(),
  integrations: z.array(z.string()),
  seo_opportunities: z.array(z.string()).describe("No invented keyword volume, rankings, or traffic projections"),
  seo_recommendations: z
    .array(SeoRecommendationSchema)
    .optional()
    .describe(
      "Detailed SEO recommendations — only include this when SEO is genuinely relevant to this client; an absent or empty array is a real answer, not a gap, when it isn't."
    ),
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
  reasoning: z.array(z.string()).describe(
    "How you arrived at the conclusions above. One bullet per major judgment call (goal classification, scope/complexity, priority, top risks) — each bullet must name the specific thing the client said or didn't say that led to that conclusion, e.g. 'Classified as e-commerce because the client selected E-Commerce Storefront and mentioned needing product filtering.' Never restate a conclusion without tying it back to the submission — a bullet with no cited evidence is not reasoning."
  ),
  confidence: z.number().min(0).max(1).describe(
    "Your confidence in this analysis, as a decimal fraction between 0.0 and 1.0 — e.g. 0.75, never a percentage like 75 or 75%"
  ),
  // Set only by the research-backed analysis/update paths (see
  // ai/researchTool.js) — absent/false for a normal analysis with no
  // external research involved.
  research_used: z.boolean().optional(),
});

module.exports = { AnalysisSchema, SeoRecommendationSchema, FeatureRecommendationSchema, SourceSchema };
