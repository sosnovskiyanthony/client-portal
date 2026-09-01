// Orchestrates one email-draft attempt: pending → processing →
// completed/failed in email_drafts, wrapping ai/aiService.js's draftEmail.
// Mirrors services/runAnalysis.js exactly — see that file's comments for the
// full reasoning (admin-only trigger, no automatic path, never rejects).
const EmailDraft = require("../models/EmailDraft");
const aiService = require("../ai/aiService");
const { AiAnalysisError } = require("../ai/errors");
const { EMAIL_PROMPT_VERSION } = require("../ai/emailPrompt");
const analysisProgress = require("../lib/analysisProgress");

async function runDraftEmail(submission, analysis) {
  const { provider, model } = aiService.getActiveProviderInfo();
  analysisProgress.start("email", submission.id, { model });

  try {
    return await runDraftEmailInner(submission, analysis, provider, model);
  } finally {
    analysisProgress.finish("email", submission.id);
  }
}

async function runDraftEmailInner(submission, analysis, provider, model) {
  try {
    await EmailDraft.createPending(submission.id);
    await EmailDraft.markProcessing(submission.id, { provider, model, promptVersion: EMAIL_PROMPT_VERSION });

    const outcome = await aiService.draftEmail(submission, analysis, {
      onProgress: (stage) => analysisProgress.setStage("email", submission.id, stage),
    });

    analysisProgress.setStage("email", submission.id, "saving");
    return await EmailDraft.markCompleted(submission.id, {
      subject: outcome.result.subject,
      body: outcome.result.body,
      provider: outcome.provider,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
    });
  } catch (err) {
    const code = err instanceof AiAnalysisError ? err.code : "unknown_error";
    const detail = err instanceof AiAnalysisError ? err.message : "An unexpected internal error occurred.";
    if (!(err instanceof AiAnalysisError)) {
      console.error("[runDraftEmail] Unexpected error:", err);
    }

    try {
      return await EmailDraft.markFailed(submission.id, {
        error: `${code}: ${detail}`,
        provider,
        model,
        promptVersion: EMAIL_PROMPT_VERSION,
      });
    } catch (dbErr) {
      console.error("[runDraftEmail] Failed to record draft failure:", dbErr);
      return null;
    }
  }
}

module.exports = { runDraftEmail };
