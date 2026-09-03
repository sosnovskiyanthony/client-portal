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
const { ServicesAnalysisSchema } = require("./servicesSchema");
const { EmailDraftSchema } = require("./emailSchema");
const {
  SYSTEM_PROMPT,
  AI_PROMPT_VERSION,
  sanitizeWebDesignSubmission,
  buildUserMessage,
  buildRawTextUserMessage,
} = require("./prompt");
const {
  AI_SERVICES_PROMPT_VERSION,
  SERVICES_SYSTEM_PROMPT,
  sanitizeServicesSubmission,
  buildServicesUserMessage,
} = require("./servicesPrompt");
const {
  AI_CHAT_PROMPT_VERSION,
  CHAT_SYSTEM_PROMPT,
  CONTEXT_ACK_MESSAGE,
  buildChatContextMessage,
} = require("./chatPrompt");
const {
  AI_ANALYSIS_UPDATE_PROMPT_VERSION,
  ANALYSIS_UPDATE_SYSTEM_PROMPT,
  buildAnalysisUpdateUserMessage,
} = require("./analysisUpdatePrompt");
const { WEB_SEARCH_TOOL, RESEARCH_INSTRUCTIONS, executeWebSearch } = require("./researchTool");
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
const { ContractEditProposalSchema } = require("./contractEditSchema");
const {
  CONTRACT_EDIT_SYSTEM_PROMPT,
  CONTRACT_EDIT_PROMPT_VERSION,
  buildContractEditUserMessage,
} = require("./contractEditPrompt");
const { GuardianReviewSchema } = require("./guardianSchema");
const {
  AI_GUARDIAN_PROMPT_VERSION,
  SYSTEM_PROMPT: GUARDIAN_SYSTEM_PROMPT,
  buildGuardianUserMessage,
} = require("./guardianPrompt");
const { AiAnalysisError } = require("./errors");
const ollamaProvider = require("./providers/ollamaProvider");
const anthropicProvider = require("./providers/anthropicProvider");
const { assertAiAllowed } = require("../guardian/aiControl");
const { logSecurityEvent } = require("../guardian/securityEvents");
const { checkCircuitBreaker } = require("../guardian/circuitBreaker");

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
  await assertAiAllowed("analyzeSubmission");
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
    logSecurityEvent({
      severity: "WARNING",
      eventType: "ai_schema_validation_failed",
      actorType: "ai_caller",
      source: "aiService",
      resourceType: "ai_operation",
      resourceId: "analyzeSubmission",
      description: `Schema validation failed for analyzeSubmission.`,
      metadata: { issueCount: validation.error.issues.length },
    }).then(() => checkCircuitBreaker()).catch(() => {});
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

// The multi-select "services" submission's analysis — the sibling to
// analyzeSubmission() above for type: "services" (see
// ai/servicesSchema.js/ai/servicesPrompt.js for why this is a separate
// schema/prompt rather than a reuse of AnalysisSchema itself). Same
// structural shape as analyzeSubmission(): sanitize → build user message →
// provider dispatch → central validation → confidence normalization.
async function analyzeServicesSubmission(submission, { client, onProgress } = {}) {
  await assertAiAllowed("analyzeServicesSubmission");
  if (submission.type !== "services") {
    throw new AiAnalysisError(
      "unsupported_type",
      `This analysis path is only implemented for "services" submissions (got "${submission.type}").`
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
  const sanitized = sanitizeServicesSubmission(submission.projectDetails);
  const userMessage = buildServicesUserMessage(sanitized);
  const model = provider.model();

  onProgress?.("sending");
  const { parsed } = await provider.impl.generateStructuredAnalysis({
    systemPrompt: SERVICES_SYSTEM_PROMPT,
    userMessage,
    zodSchema: ServicesAnalysisSchema,
    model,
    client,
    onProgress,
  });
  onProgress?.("validating");

  // Same defensive normalization as analyzeSubmission() — a local model can
  // return confidence as a 0-100 percentage instead of a 0-1 fraction, both
  // at the top level and inside each recommendation.
  if (typeof parsed?.confidence === "number" && parsed.confidence > 1) {
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence / 100));
  }
  if (Array.isArray(parsed?.recommendations)) {
    for (const r of parsed.recommendations) {
      if (typeof r?.confidence === "number" && r.confidence > 1) {
        r.confidence = Math.max(0, Math.min(1, r.confidence / 100));
      }
    }
  }

  const validation = ServicesAnalysisSchema.safeParse(parsed);
  if (!validation.success) {
    logSecurityEvent({
      severity: "WARNING",
      eventType: "ai_schema_validation_failed",
      actorType: "ai_caller",
      source: "aiService",
      resourceType: "ai_operation",
      resourceId: "analyzeServicesSubmission",
      description: `Schema validation failed for analyzeServicesSubmission.`,
      metadata: { issueCount: validation.error.issues.length },
    }).then(() => checkCircuitBreaker()).catch(() => {});
    throw new AiAnalysisError(
      "invalid_schema",
      `AI response did not match the required services-analysis schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`
    );
  }

  return {
    result: validation.data,
    model,
    provider: providerName,
    promptVersion: AI_SERVICES_PROMPT_VERSION,
  };
}

// AI chat feature's "paste raw client info and analyze it" action — reuses
// SYSTEM_PROMPT, AnalysisSchema, and AI_PROMPT_VERSION exactly as
// analyzeSubmission() above (never a separate prompt/schema for this path),
// so the result is provably indistinguishable in shape from an analysis
// produced through the normal submission workflow. The only thing that
// differs is buildRawTextUserMessage() in place of
// sanitizeWebDesignSubmission()+buildUserMessage(), since there's no
// structured form data to sanitize — just a blob of pasted text.
async function analyzeRawText(rawText, { client, onProgress } = {}) {
  await assertAiAllowed("analyzeRawText");
  const providerName = env.aiProvider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiAnalysisError(
      "unknown_provider",
      `AI_PROVIDER "${providerName}" is not recognized. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }

  onProgress?.("preparing");
  const userMessage = buildRawTextUserMessage(rawText);
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

  // Same defensive normalization as analyzeSubmission() — see that
  // function's comment for why (a local model can return confidence as a
  // 0-100 percentage instead of a 0-1 fraction).
  if (typeof parsed?.confidence === "number" && parsed.confidence > 1) {
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence / 100));
  }

  const validation = AnalysisSchema.safeParse(parsed);
  if (!validation.success) {
    logSecurityEvent({
      severity: "WARNING",
      eventType: "ai_schema_validation_failed",
      actorType: "ai_caller",
      source: "aiService",
      resourceType: "ai_operation",
      resourceId: "analyzeRawText",
      description: `Schema validation failed for analyzeRawText.`,
      metadata: { issueCount: validation.error.issues.length },
    }).then(() => checkCircuitBreaker()).catch(() => {});
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

// Replayed on every chat turn regardless of how long the conversation gets
// — without a cap, both cost and latency grow unbounded on a long back-
// and-forth. 20 turns (10 admin + 10 assistant, roughly) is generous
// headroom for real continuity while keeping a hard ceiling. Older turns
// are simply dropped, oldest first — the context message (submission +
// analysis) is re-sent every call regardless, so the model never loses
// the actual submission grounding even when older chat turns age out.
const MAX_CHAT_HISTORY_TURNS = 20;

// One turn of the AI chat feature — a free-text, conversational reply, not
// a schema-constrained one (see ai/providers/*.js's generateChatReply).
// `sanitizedIntake`/`analysisResult` seed the context message every call
// (stateless per request, like every other AI call in this app); `history`
// is the conversation's prior turns as stored (see
// models/SubmissionChat.js), each `{ role: "admin"|"assistant", content }`
// — any "analysis" role entries (from a past paste-and-analyze action) are
// filtered out here, since those are structured objects, not chat turns,
// and would need their own formatting to be useful as conversation context;
// a future enhancement could summarize them in, but that's not needed for
// the fields already carried in `analysisResult` itself.
//
// `regenerate: true` (services/runChat.js's regenerateLastReply) bumps
// temperature so a "give me a different take" retry isn't just a near-
// identical rerun of the same deterministic-ish output.
async function chatReply({ sanitizedIntake, analysisResult, history, userMessage, regenerate = false }, { client, onProgress } = {}) {
  await assertAiAllowed("chatReply");
  const providerName = env.aiProvider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiAnalysisError(
      "unknown_provider",
      `AI_PROVIDER "${providerName}" is not recognized. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }

  onProgress?.("preparing");
  const priorTurns = (history || [])
    .filter((m) => m.role === "admin" || m.role === "assistant")
    .slice(-MAX_CHAT_HISTORY_TURNS)
    .map((m) => ({ role: m.role === "admin" ? "user" : "assistant", content: String(m.content || "") }));

  const messages = [
    { role: "user", content: buildChatContextMessage(sanitizedIntake, analysisResult) },
    { role: "assistant", content: CONTEXT_ACK_MESSAGE },
    ...priorTurns,
    { role: "user", content: userMessage },
  ];
  const model = provider.model();

  onProgress?.("sending");
  const { text } = await provider.impl.generateChatReply({
    systemPrompt: CHAT_SYSTEM_PROMPT,
    messages,
    model,
    client,
    onProgress,
    temperature: regenerate ? 0.65 : undefined,
  });

  return {
    text,
    model,
    provider: providerName,
    promptVersion: AI_CHAT_PROMPT_VERSION,
  };
}

// Research only ever pairs with Ollama (see ai/researchTool.js's module
// comment and config/env.js's tavilyApiKey) — the tool-calling loop lives on
// ollamaProvider.js specifically, not behind the generic PROVIDERS
// dispatch every other function here uses. Exported so the controller can
// show/hide the "Research this" action without duplicating this check.
function isResearchAvailable() {
  return env.aiProvider === "ollama" && Boolean(env.tavilyApiKey);
}

// The AI chat feature's manual "Research this" action — same shape as
// chatReply() above (same context message, same history replay), but
// routes through ollamaProvider.js's generateChatReplyWithTools instead of
// generateChatReply, with CHAT_SYSTEM_PROMPT extended by
// RESEARCH_INSTRUCTIONS only for this call (see ai/researchTool.js — the
// base prompt every other chat turn uses stays untouched). Whether the
// model actually searches at all is still its own decision, made per call
// by its own tool-use judgment — this only makes the tool available.
async function chatReplyWithResearch({ sanitizedIntake, analysisResult, history, userMessage }, { onProgress } = {}) {
  await assertAiAllowed("chatReplyWithResearch");
  if (!isResearchAvailable()) {
    throw new AiAnalysisError(
      "research_unavailable",
      "Online research isn't configured — set TAVILY_API_KEY and use AI_PROVIDER=ollama to enable it."
    );
  }

  onProgress?.("preparing");
  const priorTurns = (history || [])
    .filter((m) => m.role === "admin" || m.role === "assistant")
    .slice(-MAX_CHAT_HISTORY_TURNS)
    .map((m) => ({ role: m.role === "admin" ? "user" : "assistant", content: String(m.content || "") }));

  const messages = [
    { role: "user", content: buildChatContextMessage(sanitizedIntake, analysisResult) },
    { role: "assistant", content: CONTEXT_ACK_MESSAGE },
    ...priorTurns,
    { role: "user", content: userMessage },
  ];
  const model = env.ollamaModel;

  onProgress?.("sending");
  const { text, sources } = await ollamaProvider.generateChatReplyWithTools({
    systemPrompt: CHAT_SYSTEM_PROMPT + RESEARCH_INSTRUCTIONS,
    messages,
    model,
    onProgress,
    tools: [WEB_SEARCH_TOOL],
    executeTool: executeWebSearch,
    maxToolCalls: 3,
  });

  return {
    text,
    sources,
    model,
    provider: "ollama",
    promptVersion: AI_CHAT_PROMPT_VERSION,
  };
}

// "Update Analysis from this Conversation" — reuses AnalysisSchema (or, for
// a "services" submission, ServicesAnalysisSchema — see submissionType
// below) exactly, never a bespoke third schema (see
// ai/analysisUpdatePrompt.js's own comment for why ANALYSIS_UPDATE_SYSTEM_PROMPT
// is a distinct prompt from SYSTEM_PROMPT/CHAT_SYSTEM_PROMPT, independent of
// which schema it's constraining output to). `currentAnalysis` is the exact
// stored result for whichever schema applies; `conversationTurns` is the
// filtered admin/assistant/analysis history (same filtering chatReply
// already does — see services/runAnalysisUpdate.js for the caller). Result
// is never saved automatically by this function — same "admin explicitly
// reviews and saves" discipline as analyzeRawText.
async function updateAnalysisFromConversation(currentAnalysis, sanitizedIntake, conversationTurns, { client, onProgress, submissionType = "web-design" } = {}) {
  await assertAiAllowed("updateAnalysisFromConversation");
  const providerName = env.aiProvider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiAnalysisError(
      "unknown_provider",
      `AI_PROVIDER "${providerName}" is not recognized. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }

  const zodSchema = submissionType === "services" ? ServicesAnalysisSchema : AnalysisSchema;

  onProgress?.("preparing");
  const userMessage = buildAnalysisUpdateUserMessage(currentAnalysis, sanitizedIntake, conversationTurns);
  const model = provider.model();

  onProgress?.("sending");
  const { parsed } = await provider.impl.generateStructuredAnalysis({
    systemPrompt: ANALYSIS_UPDATE_SYSTEM_PROMPT,
    userMessage,
    zodSchema,
    model,
    client,
    onProgress,
  });
  onProgress?.("validating");

  if (typeof parsed?.confidence === "number" && parsed.confidence > 1) {
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence / 100));
  }

  const validation = zodSchema.safeParse(parsed);
  if (!validation.success) {
    logSecurityEvent({
      severity: "WARNING",
      eventType: "ai_schema_validation_failed",
      actorType: "ai_caller",
      source: "aiService",
      resourceType: "ai_operation",
      resourceId: "updateAnalysisFromConversation",
      description: `Schema validation failed for updateAnalysisFromConversation.`,
      metadata: { issueCount: validation.error.issues.length },
    }).then(() => checkCircuitBreaker()).catch(() => {});
    throw new AiAnalysisError(
      "invalid_schema",
      `AI response did not match the required analysis schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`
    );
  }

  return {
    result: validation.data,
    model,
    provider: providerName,
    promptVersion: AI_ANALYSIS_UPDATE_PROMPT_VERSION,
  };
}

// Drafts a client-facing outreach email from a completed AI analysis. Only
// ever called once an analysis exists and succeeded (see
// services/draftEmail.js) — there's nothing useful to draft from otherwise.
async function draftEmail(submission, analysis, { client, onProgress } = {}) {
  await assertAiAllowed("draftEmail");
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
    logSecurityEvent({
      severity: "WARNING",
      eventType: "ai_schema_validation_failed",
      actorType: "ai_caller",
      source: "aiService",
      resourceType: "ai_operation",
      resourceId: "draftEmail",
      description: `Schema validation failed for draftEmail.`,
      metadata: { issueCount: validation.error.issues.length },
    }).then(() => checkCircuitBreaker()).catch(() => {});
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
  await assertAiAllowed("reviewContract");
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
    logSecurityEvent({
      severity: "WARNING",
      eventType: "ai_schema_validation_failed",
      actorType: "ai_caller",
      source: "aiService",
      resourceType: "ai_operation",
      resourceId: "reviewContract",
      description: `Schema validation failed for reviewContract.`,
      metadata: { issueCount: validation.error.issues.length },
    }).then(() => checkCircuitBreaker()).catch(() => {});
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
  await assertAiAllowed("generateContract");
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
    logSecurityEvent({
      severity: "WARNING",
      eventType: "ai_schema_validation_failed",
      actorType: "ai_caller",
      source: "aiService",
      resourceType: "ai_operation",
      resourceId: "generateContract",
      description: `Schema validation failed for generateContract.`,
      metadata: { issueCount: validation.error.issues.length },
    }).then(() => checkCircuitBreaker()).catch(() => {});
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

// AI Agreement Editor (see ai/contractEditPrompt.js,
// controllers/contractController.js's interpretContractEditInstruction /
// applyContractEditChanges) — turns an admin's plain-English instruction
// about a contract into a structured, reviewable set of proposed changes.
// This function only ever PROPOSES; it never writes to a contract, never
// finalizes, never sends — see guardian/aiCapabilities.js's own entry for
// this operation and guardian/rules.js's consequential-ops-need-human-
// approval rule, which already covers this without needing a new one.
// `currentSections` is the contract's current generatedContent.sections
// array (or [] if no draft exists yet) — the AI is shown exactly what's
// there today, nothing more, nothing assumed.
async function interpretContractEditInstruction(currentSections, instruction, { client, onProgress } = {}) {
  await assertAiAllowed("interpretContractEditInstruction");
  const providerName = env.aiProvider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiAnalysisError(
      "unknown_provider",
      `AI_PROVIDER "${providerName}" is not recognized. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }

  onProgress?.("preparing");
  const userMessage = buildContractEditUserMessage(currentSections, instruction);
  const model = provider.model();

  onProgress?.("sending");
  const { parsed } = await provider.impl.generateStructuredAnalysis({
    systemPrompt: CONTRACT_EDIT_SYSTEM_PROMPT,
    userMessage,
    zodSchema: ContractEditProposalSchema,
    model,
    client,
    onProgress,
  });
  onProgress?.("validating");

  const validation = ContractEditProposalSchema.safeParse(parsed);
  if (!validation.success) {
    logSecurityEvent({
      severity: "WARNING",
      eventType: "ai_schema_validation_failed",
      actorType: "ai_caller",
      source: "aiService",
      resourceType: "ai_operation",
      resourceId: "interpretContractEditInstruction",
      description: `Schema validation failed for interpretContractEditInstruction.`,
      metadata: { issueCount: validation.error.issues.length },
    }).then(() => checkCircuitBreaker()).catch(() => {});
    throw new AiAnalysisError(
      "invalid_schema",
      `AI response did not match the required contract-edit-proposal schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`
    );
  }

  return {
    result: validation.data,
    model,
    provider: providerName,
    promptVersion: CONTRACT_EDIT_PROMPT_VERSION,
  };
}

// Guardian's AI code reviewer (see guardian/collectDiff.js,
// guardian/reviewCli.js) — same PROVIDERS dispatch, same confidence
// normalization, same central `.safeParse` validation, same
// AiAnalysisError handling as every analysis function above. This is
// deliberately NOT a separate AI architecture: it's one more structured
// call type through the exact same infrastructure, the same way
// analyzeServicesSubmission was added alongside analyzeSubmission.
async function reviewCodeChange({ diff, changedFiles, relevantTests, baseRef, headRef, truncatedDiff }, { client, onProgress } = {}) {
  await assertAiAllowed("reviewCodeChange");
  const providerName = env.aiProvider;
  const provider = PROVIDERS[providerName];
  if (!provider) {
    throw new AiAnalysisError(
      "unknown_provider",
      `AI_PROVIDER "${providerName}" is not recognized. Expected one of: ${Object.keys(PROVIDERS).join(", ")}.`
    );
  }

  onProgress?.("preparing");
  const userMessage = buildGuardianUserMessage({ diff, changedFiles, relevantTests, baseRef, headRef, truncatedDiff });
  const model = provider.model();

  onProgress?.("sending");
  const { parsed } = await provider.impl.generateStructuredAnalysis({
    systemPrompt: GUARDIAN_SYSTEM_PROMPT,
    userMessage,
    zodSchema: GuardianReviewSchema,
    model,
    client,
    onProgress,
  });
  onProgress?.("validating");

  // Same defensive normalization as every analysis function above — a local
  // model can return confidence as a 0-100 percentage instead of a 0-1
  // fraction.
  if (typeof parsed?.confidence === "number" && parsed.confidence > 1) {
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence / 100));
  }

  const validation = GuardianReviewSchema.safeParse(parsed);
  if (!validation.success) {
    logSecurityEvent({
      severity: "WARNING",
      eventType: "ai_schema_validation_failed",
      actorType: "ai_caller",
      source: "aiService",
      resourceType: "ai_operation",
      resourceId: "reviewCodeChange",
      description: `Schema validation failed for reviewCodeChange.`,
      metadata: { issueCount: validation.error.issues.length },
    }).then(() => checkCircuitBreaker()).catch(() => {});
    throw new AiAnalysisError(
      "invalid_schema",
      `AI response did not match the required Guardian review schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`
    );
  }

  return {
    result: validation.data,
    model,
    provider: providerName,
    promptVersion: AI_GUARDIAN_PROMPT_VERSION,
  };
}

// Synchronous — lets callers record which provider/model an attempt is
// about to use (or used, on failure) without needing to complete a request.
function getActiveProviderInfo() {
  const provider = env.aiProvider;
  const entry = PROVIDERS[provider];
  return { provider, model: entry ? entry.model() : null };
}

module.exports = {
  analyzeSubmission,
  analyzeServicesSubmission,
  analyzeRawText,
  chatReply,
  chatReplyWithResearch,
  isResearchAvailable,
  updateAnalysisFromConversation,
  draftEmail,
  reviewContract,
  generateContract,
  interpretContractEditInstruction,
  reviewCodeChange,
  getActiveProviderInfo,
  AiAnalysisError,
};
