// Structured-output schema for the submission "Add Context" feature (see
// ai/contextInterpretPrompt.js, ai/aiService.js's interpretSubmissionContext).
// The AI never writes to a submission directly — this schema is what it's
// allowed to PROPOSE; controllers/adminController.js's applyContextChanges
// is the only thing that ever actually writes, and only for changes an
// admin explicitly approved. See guardian/rules.js's
// consequential-ops-need-human-approval rule.
const { z } = require("zod");

// Deliberately not exhaustive of every conceivable business fact — "other"
// exists precisely so the AI isn't forced to misclassify something that
// doesn't fit, per the spec's own "do not limit to these categories if the
// architecture suggests more" — but every category the app's own UI/pricing
// logic actually branches on (Phase 2) needs a stable name here first.
const CONTEXT_CATEGORIES = [
  "project_scope",
  "feature_requirement",
  "feature_removal",
  "client_preference",
  "budget",
  "timeline",
  "urgency",
  "business_goal",
  "target_audience",
  "technical_requirement",
  "design_preference",
  "seo_requirement",
  "ai_requirement",
  "app_requirement",
  "ecommerce_requirement",
  "content_requirement",
  "hosting_requirement",
  "maintenance_requirement",
  "payment_preference",
  "pricing_constraint",
  "competitor_context",
  "risk",
  "client_objection",
  "sales_context",
  "recurring_service_interest",
  "strategic_context",
  "other",
];

const ContextChangeSchema = z.object({
  action: z.enum(["ADD", "MODIFY", "REMOVE"]),
  category: z.enum(CONTEXT_CATEGORIES),
  field: z.string().describe(
    "A short, stable snake_case identifier for the specific fact within the category, e.g. 'ecommerce', 'appointment_booking', 'launch_date', 'stated_budget' — must match an existing field's name exactly for MODIFY/REMOVE so it can be located in the current context."
  ),
  previousValue: z.string().nullable().describe("The fact's current value before this change, in plain text — null for ADD, where there is no existing value."),
  proposedValue: z.string().nullable().describe("The new value in plain text — null for REMOVE, where nothing remains."),
  reasoning: z.string().describe("Why this specific change follows from the administrator's input — must cite what they actually said, never just restate the change."),
  confidence: z.enum(["low", "medium", "high"]).describe("How directly the input supports this specific change — low if you had to infer or guess at intent."),
});

const ContextInterpretationSchema = z.object({
  interpretation: z.string().describe("Plain-English restatement of what the administrator's input actually says, before any proposed changes."),
  proposedChanges: z.array(ContextChangeSchema).describe("Empty when clarificationNeeded is true — do not propose a best-guess change alongside a clarification request."),
  clarificationNeeded: z.boolean().describe("True when the input is genuinely too ambiguous to propose a safe, specific change, OR when it significantly contradicts an existing fact and should be confirmed before overwriting it."),
  clarificationQuestion: z.string().nullable().describe("A specific, targeted question the administrator would need to answer before this input can become a real change. Populated only when clarificationNeeded is true, otherwise null."),
  affectedAnalyses: z.array(z.string()).describe("Which downstream analyses this change could plausibly affect, e.g. ['scope', 'features', 'complexity', 'timeline', 'pricing'] — a hint for what to recalculate, not itself authoritative."),
});

module.exports = { CONTEXT_CATEGORIES, ContextChangeSchema, ContextInterpretationSchema };
