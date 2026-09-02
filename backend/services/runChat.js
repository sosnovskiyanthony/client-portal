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
const { sanitizeServicesSubmission } = require("../ai/servicesPrompt");

// Distinct from AiAnalysisError (a provider/AI failure, → 502) — this is a
// bad-state precondition (nothing to regenerate, or history got into a
// shape regenerateLastReply can't make sense of), so the controller maps
// it to 400 instead.
class RegenerateValidationError extends Error {}

// A "services" submission's projectDetails has a completely different
// shape (services[] + one nested sub-object per selected service — see
// lib/services.js) than a web-design one's (goal/summary/brandStatus/...
// flat). Using the wrong sanitizer wouldn't error — sanitizeWebDesignSubmission
// would just quietly return "Unknown / needs clarification" for nearly
// every field, since none of the expected keys exist on a services
// submission's projectDetails — so this has to dispatch on type, not just
// pick one and hope.
function sanitizeIntakeForChat(submission) {
  return submission.type === "services"
    ? sanitizeServicesSubmission(submission.projectDetails)
    : sanitizeWebDesignSubmission(submission.projectDetails);
}

// `research: true` is the "Research & Send" button — same turn, same
// persistence discipline, just routed through aiService.chatReplyWithResearch
// (a live web_search tool available to the model, its own decision whether
// to actually use it — see ai/researchTool.js) instead of the plain
// chatReply. Whatever sources it actually cites end up stored on the
// assistant message so the UI can show "Researched N sources" — omitted
// entirely (not even an empty array) for a plain reply, so the two kinds
// of message stay easy to tell apart in storage, not just in the UI.
async function runChat(submission, analysis, existingMessages, userMessage, { research = false } = {}) {
  const adminTurn = { role: "admin", content: userMessage, createdAt: new Date().toISOString() };
  await SubmissionChat.appendMessages(submission.id, [adminTurn]);

  analysisProgress.start("chat", submission.id, { model: aiService.getActiveProviderInfo().model });
  try {
    const sanitizedIntake = sanitizeIntakeForChat(submission);
    const analysisResult = analysis && analysis.status === "completed" ? analysis.result : null;
    const onProgress = (stage) => analysisProgress.setStage("chat", submission.id, stage);

    const outcome = research
      ? await aiService.chatReplyWithResearch({ sanitizedIntake, analysisResult, history: existingMessages, userMessage }, { onProgress })
      : await aiService.chatReply({ sanitizedIntake, analysisResult, history: existingMessages, userMessage }, { onProgress });

    analysisProgress.setStage("chat", submission.id, "saving");
    const assistantTurn = { role: "assistant", content: outcome.text, createdAt: new Date().toISOString() };
    if (research && Array.isArray(outcome.sources) && outcome.sources.length > 0) {
      assistantTurn.sources = outcome.sources;
    }
    return await SubmissionChat.appendMessages(submission.id, [assistantTurn]);
  } finally {
    analysisProgress.finish("chat", submission.id);
  }
}

// Pure — no I/O, so it's directly unit-testable (see test/runChat.test.js)
// without a database or a mocked AI provider. This is the one piece that
// actually decides "which prompt gets re-asked" and "what gets kept vs.
// dropped" — exactly the logic that has to be right to avoid duplicating
// the admin's message, so it's worth being able to test in isolation from
// everything else regenerateLastReply does.
//
// Finds the nearest preceding "admin" message before the trailing
// assistant one (normally the immediately-preceding one, but walks back
// past any "analysis" entries in between just in case) and returns what's
// needed to re-ask with the exact same prompt and the exact same context
// that produced it.
function findRegenerationTarget(currentMessages) {
  const messages = currentMessages || [];
  if (messages[messages.length - 1]?.role !== "assistant") {
    throw new RegenerateValidationError("The most recent message isn't an assistant reply — nothing to regenerate.");
  }

  let adminIndex = -1;
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i].role === "admin") {
      adminIndex = i;
      break;
    }
  }
  if (adminIndex === -1) {
    throw new RegenerateValidationError("Couldn't find the prompt this reply was answering.");
  }

  return {
    userMessage: messages[adminIndex].content,
    historyForReply: messages.slice(0, adminIndex),
    // Everything except the trailing assistant reply being replaced — the
    // admin's message is already in here (it's before the slice point),
    // never re-appended, so nothing gets duplicated.
    messagesBeforeReply: messages.slice(0, messages.length - 1),
  };
}

// Regenerates the most recent assistant reply in place — the "Retry" button
// in the chat UI. `currentMessages` is the full stored history, which must
// end with an assistant message (the controller enforces this before
// calling in). Everything before the admin message that prompted the reply
// being regenerated is untouched, so the rest of the conversation's
// continuity is preserved.
async function regenerateLastReply(submission, analysis, currentMessages) {
  const { userMessage, historyForReply, messagesBeforeReply } = findRegenerationTarget(currentMessages);

  analysisProgress.start("chat", submission.id, { model: aiService.getActiveProviderInfo().model });
  try {
    const sanitizedIntake = sanitizeIntakeForChat(submission);
    const analysisResult = analysis && analysis.status === "completed" ? analysis.result : null;

    const outcome = await aiService.chatReply(
      { sanitizedIntake, analysisResult, history: historyForReply, userMessage, regenerate: true },
      { onProgress: (stage) => analysisProgress.setStage("chat", submission.id, stage) }
    );

    analysisProgress.setStage("chat", submission.id, "saving");
    const newMessages = [
      ...messagesBeforeReply,
      { role: "assistant", content: outcome.text, createdAt: new Date().toISOString() },
    ];
    return await SubmissionChat.setMessages(submission.id, newMessages);
  } finally {
    analysisProgress.finish("chat", submission.id);
  }
}

module.exports = { runChat, regenerateLastReply, findRegenerationTarget, RegenerateValidationError };
