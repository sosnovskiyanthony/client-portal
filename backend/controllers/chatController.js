// AI chat feature — an interface to the same analysis pipeline
// controllers/adminController.js's analyzeSubmission already uses (see
// ai/aiService.js's chatReply/analyzeRawText). Every route here is mounted
// under routes/admin.js's existing `authenticate + requireAdmin` gate —
// nothing in this file re-implements auth.
const Submission = require("../models/Submission");
const Analysis = require("../models/Analysis");
const SubmissionChat = require("../models/SubmissionChat");
const { runChat, regenerateLastReply, RegenerateValidationError } = require("../services/runChat");
const { runRawTextAnalysis } = require("../services/runRawTextAnalysis");
const { runAnalysisUpdate } = require("../services/runAnalysisUpdate");
const { AnalysisSchema } = require("../ai/schema");
const { ServicesAnalysisSchema } = require("../ai/servicesSchema");
const { AI_PROMPT_VERSION } = require("../ai/prompt");
const { AI_SERVICES_PROMPT_VERSION } = require("../ai/servicesPrompt");
const { AiAnalysisError } = require("../ai/errors");
const aiService = require("../ai/aiService");
const analysisProgress = require("../lib/analysisProgress");

// Mirrors MAX_TEXT_FIELD_CHARS in ai/prompt.js — a chat message is admin-
// authored, not client-submitted, so this is pure cost/sanity control, not
// an injection concern. Rejected with a clear error rather than silently
// truncated, since silently cutting off part of what the admin typed (and
// then persisting only the cut version) would be actively confusing.
const MAX_CHAT_MESSAGE_CHARS = 4000;

async function loadSubmissionOr404(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid submission id." });
    return null;
  }
  const submission = await Submission.findById(id);
  if (!submission) {
    res.status(404).json({ error: "Submission not found." });
    return null;
  }
  return submission;
}

async function getChatHistory(req, res) {
  const submission = await loadSubmissionOr404(req, res);
  if (!submission) return;

  const chat = await SubmissionChat.findBySubmissionId(submission.id);
  res.json({ messages: chat ? chat.messages : [] });
}

async function sendChatMessage(req, res) {
  const submission = await loadSubmissionOr404(req, res);
  if (!submission) return;

  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    return res.status(400).json({ error: "A chat message is required." });
  }
  if (message.length > MAX_CHAT_MESSAGE_CHARS) {
    return res.status(400).json({ error: `Chat messages are limited to ${MAX_CHAT_MESSAGE_CHARS} characters.` });
  }

  const research = req.body?.research === true;

  const analysis = await Analysis.findBySubmissionId(submission.id);
  const existing = await SubmissionChat.findBySubmissionId(submission.id);

  // Classified AI-provider failures (Ollama down, timeout, unknown
  // provider, etc.) become 502, matching contractController's identical
  // convention for its own AI calls — never a silently-fabricated reply.
  // The admin's own message is still persisted regardless (see
  // services/runChat.js), so it's not lost even when this returns an error.
  try {
    const chat = await runChat(submission, analysis, existing ? existing.messages : [], message, { research });
    res.json({ chat });
  } catch (err) {
    if (err instanceof AiAnalysisError) {
      return res.status(502).json({ error: err.message, code: err.code });
    }
    throw err;
  }
}

// Whether the "Research & Send" action is even available (TAVILY_API_KEY
// configured, AI_PROVIDER=ollama) — checked once when the drawer opens, so
// the frontend never shows a button that's guaranteed to fail.
function getResearchStatus(req, res) {
  res.json({ available: aiService.isResearchAvailable() });
}

// "Retry"/"Regenerate" — replaces the most recent assistant reply with a
// fresh one, same prompt and context, without duplicating the admin's
// message (see services/runChat.js's regenerateLastReply for exactly how).
async function regenerateChatReply(req, res) {
  const submission = await loadSubmissionOr404(req, res);
  if (!submission) return;

  const existing = await SubmissionChat.findBySubmissionId(submission.id);
  if (!existing || existing.messages.length === 0) {
    return res.status(400).json({ error: "There's no reply to regenerate yet." });
  }

  const analysis = await Analysis.findBySubmissionId(submission.id);

  try {
    const chat = await regenerateLastReply(submission, analysis, existing.messages);
    res.json({ chat });
  } catch (err) {
    if (err instanceof AiAnalysisError) {
      return res.status(502).json({ error: err.message, code: err.code });
    }
    if (err instanceof RegenerateValidationError) {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
}

// "Update Analysis from this Conversation" — revises the submission's
// CURRENT analysis using the conversation as context (see
// ai/analysisUpdatePrompt.js). Only makes sense once a completed analysis
// exists (400 otherwise, same restriction adminController.draftEmail
// already applies to drafting from an analysis). The result is appended to
// the chat thread as an "analysis"-role entry — the exact same display and
// save path (saveChatAnalysis, below) that paste-and-analyze already uses —
// never written to submission_analyses until the admin explicitly saves it.
async function updateAnalysisFromChat(req, res) {
  const submission = await loadSubmissionOr404(req, res);
  if (!submission) return;

  const analysis = await Analysis.findBySubmissionId(submission.id);
  if (!analysis || analysis.status !== "completed") {
    return res.status(400).json({ error: "An analysis must exist and be completed before it can be updated from this conversation." });
  }

  const existing = await SubmissionChat.findBySubmissionId(submission.id);

  try {
    const outcome = await runAnalysisUpdate(submission, analysis.result, existing ? existing.messages : []);
    await SubmissionChat.appendMessages(submission.id, [
      { role: "analysis", content: outcome, source: "conversation_update", createdAt: new Date().toISOString() },
    ]);
    res.json(outcome);
  } catch (err) {
    if (err instanceof AiAnalysisError) {
      return res.status(502).json({ error: err.message, code: err.code });
    }
    throw err;
  }
}

function getAnalysisUpdateProgress(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  const progress = analysisProgress.get("analysis-update", id);
  if (!progress) return res.json({ active: false });
  res.json({ active: true, ...progress });
}

function getChatProgress(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  const progress = analysisProgress.get("chat", id);
  if (!progress) return res.json({ active: false });
  res.json({ active: true, ...progress });
}

// Turns a caught error from the background analysis run into the outcome
// shape analysisProgress.complete() stores and getAnalyzePastedProgress*
// hands back to the poller — shared so both the scoped and standalone
// routes below classify failures identically.
function outcomeForError(err, logContext) {
  if (err instanceof AiAnalysisError) {
    return { ok: false, error: err.message, code: err.code };
  }
  console.error(`[chatController] Unexpected error during background paste-analyze (${logContext}):`, err);
  return { ok: false, error: "Something went wrong analyzing this text.", code: "internal_error" };
}

// Both paste-and-analyze routes below respond immediately (202) and run
// the actual AI call in the background, reporting the eventual result
// through the existing progress-poll endpoints instead of holding the
// original HTTP request open for it.
//
// This isn't just responsiveness polish: a real production incident
// (2026-09-02) showed something ahead of this app dropping the
// client-facing connection well under the 2-minute mark on a slow
// analysis, well before this app's own (much larger) timeout/retry budget
// for reaching Ollama over Tailscale had a chance to finish and respond —
// so the browser saw a bare "Request failed." even when this code path
// eventually produced a real, specific error. No single HTTP request in
// this flow — the POST below, or any one poll — needs to survive more
// than an instant, which makes whatever that external cutoff actually is
// stop mattering. See ai/providers/ollamaProvider.js's REQUEST_TIMEOUT_MS
// comment for the fuller incident notes.
//
// A real, accepted limitation: if the admin closes/reopens the chat
// drawer (or the browser) while a run is still in flight, there's no
// mechanism to resume watching it — for the scoped route the eventual
// result is still safely persisted to the chat thread regardless (see
// below); for the standalone route it's held for RESULT_TTL_MS
// (lib/analysisProgress.js) and lost if nobody polls for it before then,
// same as it was always lost immediately on a dropped connection before
// this change — never worse, and usually better.

// Scoped variant also appends the result into this submission's chat
// thread as an "analysis"-role turn — so it's still there (with the pasted
// text it came from) if the admin closes and reopens the drawer, even
// before they've explicitly saved it as the submission's real analysis
// (see chatController.saveChatAnalysis; this append is never that save —
// submission_analyses is untouched here). Now happens in the background
// regardless of whether the admin is still watching, so a slow analysis
// that finishes after the client's given up is still saved, not lost.
async function analyzePastedTextForSubmission(req, res) {
  const submission = await loadSubmissionOr404(req, res);
  if (!submission) return;
  const rawText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!rawText) {
    return res.status(400).json({ error: "Pasted client text is required." });
  }
  const progressKey = submission.id;
  res.status(202).json({ started: true });

  try {
    const outcome = await runRawTextAnalysis(progressKey, rawText);
    await SubmissionChat.appendMessages(submission.id, [
      {
        role: "analysis",
        content: outcome,
        pastedText: rawText,
        createdAt: new Date().toISOString(),
      },
    ]);
    analysisProgress.complete("chat-analyze", progressKey, { ok: true, result: outcome });
  } catch (err) {
    analysisProgress.complete("chat-analyze", progressKey, outcomeForError(err, `submission ${submission.id}`));
  }
}

function formatAnalyzeProgress(progress) {
  if (!progress) return { active: false };
  if (progress.status === "done") return { active: false, done: true, ...progress.outcome };
  return { active: true, stage: progress.stage };
}

function getAnalyzePastedProgressForSubmission(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  res.json(formatAnalyzeProgress(analysisProgress.get("chat-analyze", id)));
}

// Standalone — no submission has to exist yet (e.g. a client who emailed
// directly and never used the intake form). `requestId` is generated
// client-side (see frontend/js/admin.js) purely so progress polling has a
// key to look up before any submission id exists.
async function analyzePastedTextStandalone(req, res) {
  const rawText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const requestId = typeof req.body?.requestId === "string" && req.body.requestId ? req.body.requestId : null;
  if (!requestId) {
    return res.status(400).json({ error: "A requestId is required." });
  }
  if (!rawText) {
    return res.status(400).json({ error: "Pasted client text is required." });
  }
  const progressKey = `standalone:${requestId}`;
  res.status(202).json({ started: true });

  try {
    const outcome = await runRawTextAnalysis(progressKey, rawText);
    analysisProgress.complete("chat-analyze", progressKey, { ok: true, result: outcome });
  } catch (err) {
    analysisProgress.complete("chat-analyze", progressKey, outcomeForError(err, `requestId ${requestId}`));
  }
}

function getAnalyzePastedProgressStandalone(req, res) {
  const requestId = req.params.requestId;
  res.json(formatAnalyzeProgress(analysisProgress.get("chat-analyze", `standalone:${requestId}`)));
}

// Validates and stores an analysis produced via the chat's "paste and
// analyze" action as this submission's own analysis (submission_analyses),
// overwriting whatever was there — same "one row per submission,
// re-running is just overwriting" semantics as a normal re-analyze. Never
// automatic: only ever reached by an explicit admin action in the UI.
async function saveChatAnalysis(req, res) {
  const submission = await loadSubmissionOr404(req, res);
  if (!submission) return;

  // A "services" submission's analysis has a different shape
  // (ServicesAnalysisSchema) than a web-design one's (AnalysisSchema) — see
  // ai/servicesSchema.js. Validate against whichever actually applies to
  // this submission, same as runAnalysisUpdate/analyzeServicesSubmission do.
  const schema = submission.type === "services" ? ServicesAnalysisSchema : AnalysisSchema;
  const validation = schema.safeParse(req.body?.result);
  if (!validation.success) {
    return res.status(400).json({
      error: `Provided analysis does not match the required schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`,
    });
  }

  const provider = typeof req.body?.provider === "string" ? req.body.provider : null;
  const model = typeof req.body?.model === "string" ? req.body.model : null;
  const defaultPromptVersion = submission.type === "services" ? AI_SERVICES_PROMPT_VERSION : AI_PROMPT_VERSION;
  const promptVersion = typeof req.body?.promptVersion === "string" ? req.body.promptVersion : defaultPromptVersion;

  await Analysis.createPending(submission.id);
  const analysis = await Analysis.markCompleted(submission.id, {
    result: validation.data,
    provider,
    model,
    promptVersion,
  });
  res.json({ analysis });
}

// Standalone counterpart — creates a brand-new Submission from the pasted
// text (type "web-design", so it behaves like any other submission
// afterward — re-analyzable, filterable, deletable through the normal
// dashboard) and saves the produced analysis against it. Never automatic —
// only reached by an explicit "Save as new submission" click.
async function saveStandaloneAnalysisAsSubmission(req, res) {
  const validation = AnalysisSchema.safeParse(req.body?.result);
  if (!validation.success) {
    return res.status(400).json({
      error: `Provided analysis does not match the required schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`,
    });
  }

  const rawText = typeof req.body?.rawText === "string" ? req.body.rawText.trim() : "";
  if (!rawText) {
    return res.status(400).json({ error: "The original pasted text is required to save a submission." });
  }
  const clientName = typeof req.body?.clientName === "string" && req.body.clientName.trim() ? req.body.clientName.trim() : null;
  const email = typeof req.body?.email === "string" && req.body.email.trim() ? req.body.email.trim() : null;
  const provider = typeof req.body?.provider === "string" ? req.body.provider : null;
  const model = typeof req.body?.model === "string" ? req.body.model : null;
  const promptVersion = typeof req.body?.promptVersion === "string" ? req.body.promptVersion : AI_PROMPT_VERSION;

  const submission = await Submission.create({
    type: "web-design",
    clientName,
    email,
    projectDetails: { summary: rawText, source: "chat_pasted_text" },
  });

  await Analysis.createPending(submission.id);
  const analysis = await Analysis.markCompleted(submission.id, {
    result: validation.data,
    provider,
    model,
    promptVersion,
  });
  res.json({ submission, analysis });
}

module.exports = {
  getChatHistory,
  sendChatMessage,
  getResearchStatus,
  regenerateChatReply,
  updateAnalysisFromChat,
  getAnalysisUpdateProgress,
  getChatProgress,
  analyzePastedTextForSubmission,
  getAnalyzePastedProgressForSubmission,
  analyzePastedTextStandalone,
  getAnalyzePastedProgressStandalone,
  saveChatAnalysis,
  saveStandaloneAnalysisAsSubmission,
};
