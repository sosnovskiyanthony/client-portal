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

async function runAnalysis(submission) {
  const { provider, model } = aiService.getActiveProviderInfo();

  try {
    await Analysis.createPending(submission.id);
    await Analysis.markProcessing(submission.id, { provider, model, promptVersion: AI_PROMPT_VERSION });

    const outcome = await aiService.analyzeSubmission(submission);

    return await Analysis.markCompleted(submission.id, {
      result: outcome.result,
      provider: outcome.provider,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
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
      return await Analysis.markFailed(submission.id, { error: `${code}: ${detail}`, provider, model, promptVersion: AI_PROMPT_VERSION });
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
