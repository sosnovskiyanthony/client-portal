// Orchestrates one "Add Context" interpretation attempt — turns an admin's
// plain-English note about a submission into a structured, reviewable
// proposal (see ai/contextInterpretSchema.js). Writes nothing itself: the
// proposal is purely returned for the admin to approve/reject via
// controllers/adminController.js's applyContextChanges, which is the only
// thing that ever writes (see guardian/rules.js's
// ai-context-interpret-propose-only rule).
//
// Deliberately fire-and-poll from the controller (see that file's own
// comment) — the same lesson chatController.js's paste-and-analyze routes
// already learned from a real production incident: don't hold an HTTP
// request open for a slow AI call.
const aiService = require("../ai/aiService");
const analysisProgress = require("../lib/analysisProgress");
const { sanitizeWebDesignSubmission } = require("../ai/prompt");
const { sanitizeServicesSubmission } = require("../ai/servicesPrompt");
const SubmissionContextFact = require("../models/SubmissionContextFact");

// The "current context" the AI reasons against: the client's own sanitized
// submission (source of truth, never edited) plus every admin-added fact
// still active. Exported so the controller can build the identical shape
// when displaying "Project Context" in the UI, without a second, possibly
// divergent implementation.
async function buildCurrentContext(submission) {
  const sanitize = submission.type === "services" ? sanitizeServicesSubmission : sanitizeWebDesignSubmission;
  const activeFacts = await SubmissionContextFact.findActiveBySubmissionId(submission.id);
  return {
    client_submitted: sanitize(submission.projectDetails),
    admin_added: activeFacts.map((f) => ({
      category: f.category,
      field: f.field,
      value: f.value,
      confidence: f.confidence,
      added_at: f.createdAt,
    })),
  };
}

async function runContextInterpretation(submission, instruction) {
  analysisProgress.start("context-interpret", submission.id, { model: aiService.getActiveProviderInfo().model });
  try {
    const currentContext = await buildCurrentContext(submission);
    const outcome = await aiService.interpretSubmissionContext(currentContext, instruction, {
      onProgress: (stage) => analysisProgress.setStage("context-interpret", submission.id, stage),
    });
    return outcome.result;
  } finally {
    analysisProgress.finish("context-interpret", submission.id);
  }
}

module.exports = { runContextInterpretation, buildCurrentContext };
