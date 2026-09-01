// Orchestrates "Update Analysis from this Conversation" — same
// throw-on-failure/progress-tracking shape as services/runContractReview.js
// and services/runRawTextAnalysis.js. Nothing is persisted here; the
// result only reaches submission_analyses if the admin explicitly saves it
// afterward (reuses chatController.saveChatAnalysis — the same save path
// paste-and-analyze already uses).
const aiService = require("../ai/aiService");
const analysisProgress = require("../lib/analysisProgress");
const { sanitizeWebDesignSubmission } = require("../ai/prompt");

// Same admin/assistant filtering chatReply already applies, plus "analysis"
// entries kept (summarized, not dumped raw — see
// ai/analysisUpdatePrompt.js's buildAnalysisUpdateUserMessage) since a past
// paste-and-analyze action is still relevant context for what's been
// discussed, even though it isn't a text turn.
function relevantConversationTurns(messages) {
  return (messages || []).filter((m) => m.role === "admin" || m.role === "assistant" || m.role === "analysis");
}

async function runAnalysisUpdate(submission, currentAnalysisResult, chatMessages) {
  analysisProgress.start("analysis-update", submission.id, { model: aiService.getActiveProviderInfo().model });
  try {
    const sanitizedIntake = sanitizeWebDesignSubmission(submission.projectDetails);
    const conversationTurns = relevantConversationTurns(chatMessages);

    return await aiService.updateAnalysisFromConversation(currentAnalysisResult, sanitizedIntake, conversationTurns, {
      onProgress: (stage) => analysisProgress.setStage("analysis-update", submission.id, stage),
    });
  } finally {
    analysisProgress.finish("analysis-update", submission.id);
  }
}

module.exports = { runAnalysisUpdate };
