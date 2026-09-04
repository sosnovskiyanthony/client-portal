// Orchestrates one analysis attempt: pending → processing → completed/failed
// in submission_analyses, wrapping ai/aiService.js.
//
// Only ever called one way: awaited from adminController.analyzeSubmission,
// which only runs behind authenticate + requireAdmin (see routes/admin.js).
// There is no automatic trigger anywhere — intake submission never calls
// this. AI analysis exists only when an admin explicitly clicks "Analyze
// with AI" / "Re-analyze", so Ollama can stay completely shut down between
// uses.
//
// Still deliberately swallows every error itself and never rejects — even
// though the current caller always awaits it, a failed analysis must never
// surface as a thrown error; it's recorded as analysis.status = 'failed'
// and returned normally, same as a successful one.
const Analysis = require("../models/Analysis");
const aiService = require("../ai/aiService");
const { AiAnalysisError } = require("../ai/errors");
const { AI_PROMPT_VERSION } = require("../ai/prompt");
const { AI_SERVICES_PROMPT_VERSION } = require("../ai/servicesPrompt");
const analysisProgress = require("../lib/analysisProgress");

// web-design submissions use aiService.analyzeSubmission()/AnalysisSchema;
// the multi-select "services" submissions use analyzeServicesSubmission()/
// ServicesAnalysisSchema (see ai/servicesSchema.js for why that's a
// genuinely separate schema, not a reuse of AnalysisSchema's web-design-
// specific fields). Same orchestration shape either way — this table is
// the only thing that varies per type.
const ANALYSIS_FN_BY_TYPE = {
  "web-design": { fn: (s, opts) => aiService.analyzeSubmission(s, opts), promptVersion: AI_PROMPT_VERSION },
  services: { fn: (s, opts) => aiService.analyzeServicesSubmission(s, opts), promptVersion: AI_SERVICES_PROMPT_VERSION },
};

async function runAnalysis(submission) {
  const { provider, model } = aiService.getActiveProviderInfo();
  analysisProgress.start("analysis", submission.id, { model });

  try {
    return await runAnalysisInner(submission, provider, model);
  } finally {
    // Always clear the progress entry, success or failure — otherwise a
    // failed run would leave a stale "in progress" row that the next
    // dashboard poll would show forever, since nothing else ever deletes it.
    analysisProgress.finish("analysis", submission.id);
  }
}

async function runAnalysisInner(submission, provider, model) {
  const entry = ANALYSIS_FN_BY_TYPE[submission.type];
  const promptVersion = entry ? entry.promptVersion : AI_PROMPT_VERSION;
  try {
    if (!entry) {
      // Mirrors aiService.analyzeSubmission's own "unsupported_type" check
      // — reachable here too if this is ever called directly for a seo/
      // contact submission, which have no analysis pipeline at all.
      throw new AiAnalysisError("unsupported_type", `AI analysis is not implemented for "${submission.type}" submissions.`);
    }

    await Analysis.createPending(submission.id);
    await Analysis.markProcessing(submission.id, { provider, model, promptVersion });

    const outcome = await entry.fn(submission, {
      onProgress: (stage) => analysisProgress.setStage("analysis", submission.id, stage),
    });

    analysisProgress.setStage("analysis", submission.id, "saving");
    return await Analysis.markCompleted(submission.id, {
      result: outcome.result,
      provider: outcome.provider,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      contextVersion: submission.contextVersion || 0,
    });
  } catch (err) {
    const code = err instanceof AiAnalysisError ? err.code : "unknown_error";
    // err.message on an AiAnalysisError is always a message we wrote
    // ourselves (see ai/errors.js call sites) — a schema-validation summary
    // or a plain description like "Ollama is not reachable". It never
    // contains a stack trace, API key, or raw provider payload, so it's
    // safe to store and show the admin, unlike err.cause (never stored).
    const detail = err instanceof AiAnalysisError ? err.message : "An unexpected internal error occurred.";
    if (!(err instanceof AiAnalysisError)) {
      // Something outside the classified AI-provider error space — a DB
      // failure, a programming error, etc. Log it server-side (never to the
      // client) for debugging; still never let it escape this function.
      console.error("[runAnalysis] Unexpected error:", err);
    }

    try {
      return await Analysis.markFailed(submission.id, { error: `${code}: ${detail}`, provider, model, promptVersion });
    } catch (dbErr) {
      // The DB write to record the failure itself failed. Nothing left to
      // do but log — the underlying submission is still safe either way,
      // since it was already saved before analysis ever started.
      console.error("[runAnalysis] Failed to record analysis failure:", dbErr);
      return null;
    }
  }
}

module.exports = { runAnalysis };
