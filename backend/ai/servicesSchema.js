// Structured-output schema for the multi-select "services" submission
// analysis — the sibling to ai/schema.js's AnalysisSchema for
// type: "web-design" submissions. A genuinely separate schema (not a reuse
// of AnalysisSchema itself), since AnalysisSchema's fields
// (cms_recommendation, recommended_website_type, etc.) are web-design-
// specific and don't generalize to "this client only wants AI
// Integration." Same reuse discipline as everything else in this app: same
// Zod-then-validate pattern, same delimiter-based prompt (ai/servicesPrompt.js),
// same provider dispatch (ai/aiService.js), same RiskSchema/
// ScopeRecommendationSchema/TimelineRecommendationSchema shapes as
// ai/schema.js (imported, not redefined) — reused wherever the shape is
// genuinely the same, not just superficially similar.
const { z } = require("zod");
const { RiskSchema, ScopeRecommendationSchema, TimelineRecommendationSchema } = require("./schema");

// One flat, rankable list across every selected service — a single "how
// useful is this, really" ordering, rather than five disconnected
// per-service lists that can't be compared against each other. `origin`
// keeps client-requested and AI-suggested strictly distinct, per this
// app's existing required_features/recommended_features discipline —
// never blended, never presented as something the client asked for when
// they didn't.
const RecommendationSchema = z.object({
  feature: z.string().describe("What should be done/built"),
  service: z.enum(["web-design", "seo", "ai-integration", "app-building", "web-management"]).describe("Which selected service this recommendation belongs to"),
  origin: z.enum(["requested", "suggested"]).describe("'requested' only if the client explicitly asked for this — never inferred"),
  why: z.string().describe("Why this fits this specific client — not generic advice"),
  evidence: z.string().describe("What in the submission actually supports this"),
  expected_value: z.string().describe("What problem/opportunity this addresses"),
  priority: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  considerations: z.string().optional().describe("Anything worth flagging before implementing it"),
});

// Only present when "web-design" was one of the selected services — see
// ai/servicesPrompt.js's instruction not to populate a section for a
// service that wasn't selected. Overlaps deliberately with (a strict
// subset of) AnalysisSchema's own fields — the same underlying
// question, asked within a combined submission instead of a dedicated one.
const WebDesignAnalysisSchema = z.object({
  recommended_website_type: z.string(),
  recommended_site_structure: z.string(),
  recommended_pages: z.array(z.string()),
  cms_recommendation: z.string(),
  ux_considerations: z.array(z.string()),
  accessibility_considerations: z.array(z.string()),
  brand_requirements: z.string(),
});

const SeoAnalysisSchema = z.object({
  seo_opportunities: z.array(z.string()).describe("No invented keyword volume, rankings, or traffic projections"),
  technical_seo_considerations: z.array(z.string()),
  content_requirements: z.array(z.string()),
});

const AiIntegrationAnalysisSchema = z.object({
  ai_opportunity: z.string().describe("The actual business opportunity — not generic AI enthusiasm"),
  recommended_approach: z.string(),
  integration_requirements: z.array(z.string()),
  data_considerations: z.string(),
  privacy_security_considerations: z.array(z.string()),
  human_in_the_loop_considerations: z.string().describe("Where a human should stay in the loop rather than full automation"),
  operational_considerations: z.string().describe("Ongoing cost/reliability/maintenance implications"),
  risks: z.array(RiskSchema),
});

const AppBuildingAnalysisSchema = z.object({
  user_types: z.array(z.string()),
  core_workflows: z.array(z.string()),
  recommended_architecture: z.string(),
  data_requirements: z.array(z.string()),
  auth_and_roles_considerations: z.string(),
  integrations: z.array(z.string()),
  technical_complexity: z.enum(["low", "medium", "high"]),
  scalability_considerations: z.string(),
  risks: z.array(RiskSchema),
});

const WebManagementAnalysisSchema = z.object({
  current_state_assessment: z.string(),
  recommended_maintenance_tasks: z.array(z.string()),
  security_considerations: z.array(z.string()),
  performance_considerations: z.array(z.string()),
  seo_opportunities: z.array(z.string()),
  engagement_recommendation: z.enum(["one_time", "ongoing", "either"]),
  risks: z.array(RiskSchema),
});

const ServicesAnalysisSchema = z.object({
  project_summary: z.string().describe("Concise professional summary covering every selected service, based only on the actual submission"),
  target_audience: z.string(),
  required_features: z.array(z.string()).describe("Facts the client explicitly stated — never AI opinion"),
  recommended_features: z.array(z.string()).describe("Short-form AI suggestions — the detailed version lives in `recommendations`"),
  recommendations: z.array(RecommendationSchema).describe("Ranked, evidence-based recommendations across every selected service — an empty array is a valid, honest answer"),

  web_design_analysis: WebDesignAnalysisSchema.optional(),
  seo_analysis: SeoAnalysisSchema.optional(),
  ai_integration_analysis: AiIntegrationAnalysisSchema.optional(),
  app_building_analysis: AppBuildingAnalysisSchema.optional(),
  web_management_analysis: WebManagementAnalysisSchema.optional(),

  missing_information: z.array(z.string()),
  critical_questions: z.array(z.string()),
  nice_to_have_questions: z.array(z.string()),
  scope_recommendation: ScopeRecommendationSchema,
  complexity: z.enum(["low", "medium", "high"]),
  timeline_recommendation: TimelineRecommendationSchema,
  priority: z.enum(["low", "medium", "high"]),
  internal_notes: z.array(z.string()).describe("Private observations for the business owner — never shown to the client"),
  reasoning: z.array(z.string()).describe(
    "One bullet per major judgment call, each naming the specific thing the client said or didn't say that led to that conclusion — same discipline as ai/schema.js's AnalysisSchema."
  ),
  confidence: z.number().min(0).max(1),
});

module.exports = {
  ServicesAnalysisSchema,
  RecommendationSchema,
  WebDesignAnalysisSchema,
  SeoAnalysisSchema,
  AiIntegrationAnalysisSchema,
  AppBuildingAnalysisSchema,
  WebManagementAnalysisSchema,
};
