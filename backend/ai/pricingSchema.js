// Structured-output schema for the AI Pricing & Offer Strategy (see
// ai/pricingPrompt.js, ai/aiService.js's generatePricingStrategy). Every
// field here is an ADVISORY internal estimate for the studio owner's own
// use — never a quote, never a commitment, never written to a contract
// automatically (see guardian/rules.js's pricing-strategy-advisory-only
// rule). The admin remains the only one who ever sets a real contract
// price, by hand, in the existing separate Contracts feature.
const { z } = require("zod");

const BUDGET_CONFIDENCE = ["explicit", "approximate", "maximum", "desired", "implied", "unknown"];
const BUDGET_ALIGNMENT = ["strongly_aligned", "reasonably_aligned", "slight_mismatch", "significant_mismatch", "severe_mismatch", "unknown"];
const FEATURE_CLASSIFICATION = ["KEEP", "SIMPLIFY", "DEFER", "REMOVE"];

const FeatureClassificationSchema = z.object({
  feature: z.string().describe("The feature or requirement being classified — from required_features/recommended_features or an admin-added feature_requirement fact"),
  classification: z.enum(FEATURE_CLASSIFICATION),
  reasoning: z.string().describe("Why this feature got this classification — must reference client importance, business importance, complexity, or cost contribution, not a generic justification"),
});

const DealOptionSchema = z.object({
  label: z.string().describe("e.g. 'Recommended Deal', 'Alternative Deal', 'Premium / Full Scope', or a phase name like 'Phase 1'"),
  price: z.string().describe("A dollar figure or range in plain text (e.g. '$8,500' or '$8,000-$9,500') — never a bare number with no currency, never invented false precision"),
  includedScope: z.array(z.string()).describe("What this option actually includes"),
  deferredOrRemoved: z.array(z.string()).describe("What this option excludes relative to the full requested scope — empty array if nothing is excluded"),
  paymentStructure: z.string().nullable().describe("e.g. 'Deposit + milestones', 'Build + $350/mo management' — null if not specified/not relevant to this option"),
  reasoning: z.string().describe("Why this specific price and structure follows from the project value, the client's budget situation, and the classified features"),
});

const PricingStrategySchema = z.object({
  projectValueLow: z.string().describe("Low end of what this project would reasonably be priced at, independent of the client's stated budget — a dollar figure in plain text"),
  projectValueHigh: z.string().describe("High end of the same independent range"),
  projectValueReasoning: z.string().describe("Why this range, grounded in the $1,500-per-feature anchor adjusted for complexity/importance/design/timeline/risk/interdependency — never anchor x count as a bare multiplication"),

  clientBudget: z.string().nullable().describe("The client's stated budget in plain text, taken only from an actual budget fact in the current context — null if no budget information exists anywhere"),
  budgetConfidence: z.enum(BUDGET_CONFIDENCE).describe("How firm the budget figure is — 'unknown' when clientBudget is null"),
  budgetAlignment: z.enum(BUDGET_ALIGNMENT),
  budgetAlignmentReasoning: z.string(),

  featureClassification: z.array(FeatureClassificationSchema),

  recommendedDeal: DealOptionSchema.describe("The primary commercial recommendation — the actual answer to 'what should we propose'"),
  alternativeDeal: DealOptionSchema.nullable().describe("A lower-cost path that can realistically be delivered — null only when budget and project value are already strongly aligned and no lower-cost path is needed"),
  premiumDeal: DealOptionSchema.nullable().describe("The price/scope for the client's complete requested vision — null when it's the same as recommendedDeal (no scope was cut)"),

  budgetTooLow: z.boolean().describe("True only for a severe mismatch where no reasonable scope reduction or payment structure closes the gap — the honest 'this may not be commercially viable as scoped' case"),
  budgetGapExplanation: z.string().nullable().describe("Populated only when budgetTooLow is true — a direct, honest explanation of the mismatch and what would need to change"),

  recurringServiceOpportunities: z.array(z.string()).describe("Legitimate ongoing-service opportunities implied by the project context (e.g. website management) — empty array if none, never padded"),
  closingStrategy: z.string().describe("Practical guidance on how to present this to the client — grounded in their actual stated context (urgency, objections, sophistication), never generic sales language"),

  risks: z.array(z.string()).describe("Pricing-specific risks — e.g. scope ambiguity that could blow past this estimate, a feature whose complexity is genuinely unclear"),
  reasoning: z.array(z.string()).describe("The overall reasoning trace for this pricing strategy, each entry tracing a specific judgment call back to something specific in the project context"),
});

module.exports = { BUDGET_CONFIDENCE, BUDGET_ALIGNMENT, FEATURE_CLASSIFICATION, FeatureClassificationSchema, DealOptionSchema, PricingStrategySchema };
