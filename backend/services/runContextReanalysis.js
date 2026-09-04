// Automatically re-runs the submission's analysis after an "Add Context"
// batch is applied (see services/applyContextChanges.js) — the "analysis
// recalculates" step of the Add Context loop. Reuses
// ai/aiService.js's updateAnalysisFromConversation (the exact mechanism
// the chat feature's "Update Analysis from this Conversation" action
// already uses) rather than a second AI capability: the approved context
// changes are formatted as one synthetic admin "conversation turn" so the
// existing REVISE-not-regenerate prompt (ai/analysisUpdatePrompt.js) does
// the same targeted, grounded revision here that it already does for chat.
//
// Unlike the chat feature's version (services/runAnalysisUpdate.js), this
// one DOES persist its result — Add Context's whole point is that
// approval already happened (the context change itself), so recalculating
// off the back of it is expected, automatic behavior, not a second
// preview-then-save step.
const aiService = require("../ai/aiService");
const analysisProgress = require("../lib/analysisProgress");
const { sanitizeWebDesignSubmission } = require("../ai/prompt");
const { sanitizeServicesSubmission } = require("../ai/servicesPrompt");
const Analysis = require("../models/Analysis");
const { AI_ANALYSIS_UPDATE_PROMPT_VERSION } = require("../ai/analysisUpdatePrompt");
const { AiAnalysisError } = require("../ai/errors");

const CHANGE_TYPE_LABEL = { ADD: "Added", MODIFY: "Updated", REMOVE: "Removed" };

// A plain-English summary of exactly the changes just applied — this is
// what stands in for "what was discussed" in the reused
// update-from-conversation prompt, so the revision is grounded in the
// actual approved facts, not a vague paraphrase.
function summarizeChanges(approvedChanges) {
  return approvedChanges
    .map((c) => `${CHANGE_TYPE_LABEL[c.action] || c.action} (${c.category}/${c.field}): ${c.action === "REMOVE" ? c.previousValue : c.proposedValue}${c.reasoning ? ` — ${c.reasoning}` : ""}`)
    .join("\n");
}

// Unlike services/runContextInterpretation.js's finish()-only pattern (that
// controller holds the eventual result itself, via analysisProgress's
// generic done-outcome path), this one explicitly records success AND
// failure via complete() — a failed reanalysis must never just vanish into
// a server log with the admin's dashboard silently going on showing the
// old (now-stale) analysis with no explanation. The previous successful
// analysis result is never overwritten by a failed attempt — only
// Analysis.markCompleted (success) touches submission_analyses at all.
async function runContextReanalysis(submission, currentAnalysisResult, approvedChanges, contextVersion) {
  analysisProgress.start("context-reanalysis", submission.id, { model: aiService.getActiveProviderInfo().model });
  try {
    const sanitize = submission.type === "services" ? sanitizeServicesSubmission : sanitizeWebDesignSubmission;
    const sanitizedIntake = sanitize(submission.projectDetails);
    const conversationTurns = [{ role: "admin", content: `New project context was just confirmed:\n${summarizeChanges(approvedChanges)}` }];

    const outcome = await aiService.updateAnalysisFromConversation(currentAnalysisResult, sanitizedIntake, conversationTurns, {
      onProgress: (stage) => analysisProgress.setStage("context-reanalysis", submission.id, stage),
      submissionType: submission.type,
    });

    analysisProgress.setStage("context-reanalysis", submission.id, "saving");
    const analysis = await Analysis.markCompleted(submission.id, {
      result: outcome.result,
      provider: outcome.provider,
      model: outcome.model,
      promptVersion: outcome.promptVersion || AI_ANALYSIS_UPDATE_PROMPT_VERSION,
      contextVersion,
    });
    analysisProgress.complete("context-reanalysis", submission.id, { ok: true, analysis });
    return analysis;
  } catch (err) {
    if (err instanceof AiAnalysisError) {
      analysisProgress.complete("context-reanalysis", submission.id, { ok: false, error: err.message, code: err.code });
    } else {
      console.error(`[runContextReanalysis] Unexpected error (submission ${submission.id}):`, err);
      analysisProgress.complete("context-reanalysis", submission.id, { ok: false, error: "Something went wrong recalculating the analysis.", code: "internal_error" });
    }
    return null;
  }
}

module.exports = { runContextReanalysis };
