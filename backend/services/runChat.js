// Orchestrates one AI chat turn. Deliberately DOES throw on failure (same
// reasoning as services/runContractReview.js) — the caller
// (chatController.sendChatMessage) awaits this directly and needs a real
// error to turn into an HTTP response, not a stored "failed" row.
//
// submission_chats has no pending/processing/failed lifecycle (see
// models/SubmissionChat.js) — a conversation isn't a single result to
// overwrite. Instead, the admin's message is persisted immediately, before
// the AI call, so a failed reply (Ollama down, timeout, etc.) never loses
// what the admin typed — only the assistant's turn is missing, and the
// admin can just try again.
const SubmissionChat = require("../models/SubmissionChat");
const aiService = require("../ai/aiService");
const analysisProgress = require("../lib/analysisProgress");
const { sanitizeWebDesignSubmission } = require("../ai/prompt");

async function runChat(submission, analysis, existingMessages, userMessage) {
  const adminTurn = { role: "admin", content: userMessage, createdAt: new Date().toISOString() };
  await SubmissionChat.appendMessages(submission.id, [adminTurn]);

  analysisProgress.start("chat", submission.id, { model: aiService.getActiveProviderInfo().model });
  try {
    const sanitizedIntake = sanitizeWebDesignSubmission(submission.projectDetails);
    const analysisResult = analysis && analysis.status === "completed" ? analysis.result : null;

    const outcome = await aiService.chatReply(
      { sanitizedIntake, analysisResult, history: existingMessages, userMessage },
      { onProgress: (stage) => analysisProgress.setStage("chat", submission.id, stage) }
    );

    analysisProgress.setStage("chat", submission.id, "saving");
    return await SubmissionChat.appendMessages(submission.id, [
      { role: "assistant", content: outcome.text, createdAt: new Date().toISOString() },
    ]);
  } finally {
    analysisProgress.finish("chat", submission.id);
  }
}

module.exports = { runChat };
