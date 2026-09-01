// Single entry point for AI project analysis, regardless of which provider
// is active. Callers (intakeController.js, adminController.js) only ever
// import this module — they never touch a provider directly, so swapping
// AI_PROVIDER never requires a call-site change.
//
//   AIService (this file)
//   ├── OllamaProvider    (default — $0 cost, local inference)
//   └── AnthropicProvider (opt-in via AI_PROVIDER=anthropic, dormant by default)
const env = require("../config/env");
const { AnalysisSchema } = require("./schema");
const { EmailDraftSchema } = require("./emailSchema");
const {
  SYSTEM_PROMPT,
  AI_PROMPT_VERSION,
  sanitizeWebDesignSubmission,
  buildUserMessage,
} = require("./prompt");
const {
  EMAIL_SYSTEM_PROMPT,
  EMAIL_PROMPT_VERSION,
  buildEmailContext,
  buildEmailUserMessage,
} = require("./emailPrompt");
const { ContractReviewSchema } = require("./contractReviewSchema");
const {
  CONTRACT_REVIEW_SYSTEM_PROMPT,
  CONTRACT_REVIEW_PROMPT_VERSION,
  buildContractReviewUserMessage,
} = require("./contractReviewPrompt");
const { ContractDraftSchema } = require("./contractSchema");
const {
  CONTRACT_SYSTEM_PROMPT,
  CONTRACT_PROMPT_VERSION,
  buildContractUserMessage,
} = require("./contractPrompt");
const { AiAnalysisError } = require("./errors");
const ollamaProvider = require("./providers/ollamaProvider");
const anthropicProvider = require("./providers/anthropicProvider");

const PROVIDERS = {
  ollama: { impl: ollamaProvider, model: () => env.ollamaModel },
  anthropic: { impl: anthropicProvider, model: () => env.aiModel },
};

// `client` is injectable (passed through to whichever provider is active)
// so tests can fake the network/SDK call — see test/aiAnalysis.test.js.
// `onProgress` is optional and only ever used by services/runAnalysis.js to
// drive lib/analysisProgress.js — every call site that doesn't pass it
// (including every existing test) works unchanged, since every call below
// is guarded with `?.`.
async function analyzeSubmission(submission, { client, onProgress } = {}) {
  // Scoped to web-design intake submissions only — the only type whose
  // fields (goals, features, brand status, etc.) this analysis, its
  // sanitizer, and its schema are built around. seo/contact submissions are
  // untouched by this feature.
  if (submission.type !== "web-design") {
    throw new AiAnalysisError(
      "unsupported_type",
      `AI analysis is only implemented for "web-design" submissions (got "${submission.type}").`
    );
  }

  const providerName = env.aiProvider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiAnalysisError(
      "unknown_provider",
      `AI_PROVIDER "${providerName}" is not recognized. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }

  onProgress?.("preparing");
  const sanitized = sanitizeWebDesignSubmission(submission.projectDetails);
  const userMessage = buildUserMessage(sanitized);
  const model = provider.model();

  onProgress?.("sending");
  const { parsed } = await provider.impl.generateStructuredAnalysis({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    zodSchema: AnalysisSchema,
    model,
    client,
    onProgress,
  });
  onProgress?.("validating");

  // Defensive normalization before validation: smaller local models can
  // satisfy every other field of a large schema correctly and still return
  // "confidence" as a percentage (e.g. 85) instead of a 0–1 fraction, even
  // with constrained decoding and an explicit field description. Observed
  // directly against qwen2.5:7b — cheap enough to guard for regardless of
  // provider.
  if (typeof parsed?.confidence === "number" && parsed.confidence > 1) {
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence / 100));
  }

  // Central validation point regardless of provider — Ollama has no
  // built-in schema enforcement guarantee beyond constrained decoding, and
  // even the Anthropic SDK's own parse step is worth re-checking here
  // rather than trusting each provider's internal validation differently.
  const validation = AnalysisSchema.safeParse(parsed);
  if (!validation.success) {
    throw new AiAnalysisError(
      "invalid_schema",
      `AI response did not match the required analysis schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`
    );
  }

  return {
    result: validation.data,
    model,
    provider: providerName,
    promptVersion: AI_PROMPT_VERSION,
  };
}

// Drafts a client-facing outreach email from a completed AI analysis. Only
// ever called once an analysis exists and succeeded (see
// services/draftEmail.js) — there's nothing useful to draft from otherwise.
async function draftEmail(submission, analysis, { client, onProgress } = {}) {
  if (!analysis || analysis.status !== "completed" || !analysis.result) {
    throw new AiAnalysisError(
      "no_analysis",
      "An outreach email can only be drafted once AI analysis has completed for this submission."
    );
  }

  const providerName = env.aiProvider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiAnalysisError(
      "unknown_provider",
      `AI_PROVIDER "${providerName}" is not recognized. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }

  onProgress?.("preparing");
  const context = buildEmailContext(submission, analysis);
  const userMessage = buildEmailUserMessage(context);
  const model = provider.model();

  onProgress?.("sending");
  const { parsed } = await provider.impl.generateStructuredAnalysis({
    systemPrompt: EMAIL_SYSTEM_PROMPT,
    userMessage,
    zodSchema: EmailDraftSchema,
    model,
    client,
    onProgress,
  });
  onProgress?.("validating");

  const validation = EmailDraftSchema.safeParse(parsed);
  if (!validation.success) {
    throw new AiAnalysisError(
      "invalid_schema",
      `AI response did not match the required email schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`
    );
  }

  return {
    result: validation.data,
    model,
    provider: providerName,
    promptVersion: EMAIL_PROMPT_VERSION,
  };
}

// AI Task 1 (see ai/contractReviewPrompt.js) — checks admin-approved
// contract data for gaps/conflicts before it's ever drafted into contract
// prose. `approvedData` is the shape ai/contractData.js's
// buildApprovedContractData() produces; this function never touches the
// database or knows what a "contract" is beyond that shape, matching
// analyzeSubmission/draftEmail's own separation of concerns.
async function reviewContract(approvedData, { client, onProgress } = {}) {
  const providerName = env.aiProvider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiAnalysisError(
      "unknown_provider",
      `AI_PROVIDER "${providerName}" is not recognized. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }

  onProgress?.("preparing");
  const userMessage = buildContractReviewUserMessage(approvedData);
  const model = provider.model();

  onProgress?.("sending");
  const { parsed } = await provider.impl.generateStructuredAnalysis({
    systemPrompt: CONTRACT_REVIEW_SYSTEM_PROMPT,
    userMessage,
    zodSchema: ContractReviewSchema,
    model,
    client,
    onProgress,
  });
  onProgress?.("validating");

  const validation = ContractReviewSchema.safeParse(parsed);
  if (!validation.success) {
    throw new AiAnalysisError(
      "invalid_schema",
      `AI response did not match the required contract-review schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`
    );
  }

  return {
    result: validation.data,
    model,
    provider: providerName,
    promptVersion: CONTRACT_REVIEW_PROMPT_VERSION,
  };
}

// AI Task 2 (see ai/contractPrompt.js) — turns admin-approved contract data
// into actual contract prose, one section per template section.
// `templateSections` is the active ContractTemplate's `sections` array
// (key/title/body_template) — never hardcoded here, so an admin editing
// the template changes what gets drafted without a code change.
async function generateContract(approvedData, templateSections, { client, onProgress } = {}) {
  const providerName = env.aiProvider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiAnalysisError(
      "unknown_provider",
      `AI_PROVIDER "${providerName}" is not recognized. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }

  onProgress?.("preparing");
  const userMessage = buildContractUserMessage(approvedData, templateSections);
  const model = provider.model();

  onProgress?.("sending");
  const { parsed } = await provider.impl.generateStructuredAnalysis({
    systemPrompt: CONTRACT_SYSTEM_PROMPT,
    userMessage,
    zodSchema: ContractDraftSchema,
    model,
    client,
    onProgress,
  });
  onProgress?.("validating");

  const validation = ContractDraftSchema.safeParse(parsed);
  if (!validation.success) {
    throw new AiAnalysisError(
      "invalid_schema",
      `AI response did not match the required contract-draft schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`
    );
  }

  return {
    result: validation.data,
    model,
    provider: providerName,
    promptVersion: CONTRACT_PROMPT_VERSION,
  };
}

// Synchronous — lets callers record which provider/model an attempt is
// about to use (or used, on failure) without needing to complete a request.
function getActiveProviderInfo() {
  const provider = env.aiProvider;
  const entry = PROVIDERS[provider];
  return { provider, model: entry ? entry.model() : null };
}

module.exports = { analyzeSubmission, draftEmail, reviewContract, generateContract, getActiveProviderInfo, AiAnalysisError };
