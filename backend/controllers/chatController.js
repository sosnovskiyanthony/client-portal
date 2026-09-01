// AI chat feature — an interface to the same analysis pipeline
// controllers/adminController.js's analyzeSubmission already uses (see
// ai/aiService.js's chatReply/analyzeRawText). Every route here is mounted
// under routes/admin.js's existing `authenticate + requireAdmin` gate —
// nothing in this file re-implements auth.
const Submission = require("../models/Submission");
const Analysis = require("../models/Analysis");
const SubmissionChat = require("../models/SubmissionChat");
const { runChat } = require("../services/runChat");
const { runRawTextAnalysis } = require("../services/runRawTextAnalysis");
const { AnalysisSchema } = require("../ai/schema");
const { AI_PROMPT_VERSION } = require("../ai/prompt");
const { AiAnalysisError } = require("../ai/errors");
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

  const analysis = await Analysis.findBySubmissionId(submission.id);
  const existing = await SubmissionChat.findBySubmissionId(submission.id);

  // Classified AI-provider failures (Ollama down, timeout, unknown
  // provider, etc.) become 502, matching contractController's identical
  // convention for its own AI calls — never a silently-fabricated reply.
  // The admin's own message is still persisted regardless (see
  // services/runChat.js), so it's not lost even when this returns an error.
  try {
    const chat = await runChat(submission, analysis, existing ? existing.messages : [], message);
    res.json({ chat });
  } catch (err) {
    if (err instanceof AiAnalysisError) {
      return res.status(502).json({ error: err.message, code: err.code });
    }
    throw err;
  }
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

// Shared by the submission-scoped and standalone "paste client text and
// analyze" routes below — the only difference between them is what
// progress-poll key is used and whether a submission exists at all. Returns
// undefined (having already written the response) on any failure — both a
// 400 (no text) and a 502 (classified AI-provider failure, same convention
// as contractController's own AI calls) — so every caller's `if (!outcome)
// return;` covers both cases without needing to know which one happened.
async function runPastedTextAnalysis(res, progressKey, rawText) {
  if (!rawText) {
    res.status(400).json({ error: "Pasted client text is required." });
    return undefined;
  }
  try {
    return await runRawTextAnalysis(progressKey, rawText);
  } catch (err) {
    if (err instanceof AiAnalysisError) {
      res.status(502).json({ error: err.message, code: err.code });
      return undefined;
    }
    throw err;
  }
}

// Scoped variant also appends the result into this submission's chat
// thread as an "analysis"-role turn — so it's still there (with the pasted
// text it came from) if the admin closes and reopens the drawer, even
// before they've explicitly saved it as the submission's real analysis
// (see chatController.saveChatAnalysis; this append is never that save —
// submission_analyses is untouched here).
async function analyzePastedTextForSubmission(req, res) {
  const submission = await loadSubmissionOr404(req, res);
  if (!submission) return;
  const rawText = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const outcome = await runPastedTextAnalysis(res, submission.id, rawText);
  if (!outcome) return; // runPastedTextAnalysis already sent a 400

  await SubmissionChat.appendMessages(submission.id, [
    {
      role: "analysis",
      content: outcome,
      pastedText: rawText,
      createdAt: new Date().toISOString(),
    },
  ]);
  res.json(outcome);
}

function getAnalyzePastedProgressForSubmission(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  const progress = analysisProgress.get("chat-analyze", id);
  if (!progress) return res.json({ active: false });
  res.json({ active: true, ...progress });
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
  const outcome = await runPastedTextAnalysis(res, `standalone:${requestId}`, rawText);
  if (!outcome) return; // runPastedTextAnalysis already sent a 400
  res.json(outcome);
}

function getAnalyzePastedProgressStandalone(req, res) {
  const requestId = req.params.requestId;
  const progress = analysisProgress.get("chat-analyze", `standalone:${requestId}`);
  if (!progress) return res.json({ active: false });
  res.json({ active: true, ...progress });
}

// Validates and stores an analysis produced via the chat's "paste and
// analyze" action as this submission's own analysis (submission_analyses),
// overwriting whatever was there — same "one row per submission,
// re-running is just overwriting" semantics as a normal re-analyze. Never
// automatic: only ever reached by an explicit admin action in the UI.
async function saveChatAnalysis(req, res) {
  const submission = await loadSubmissionOr404(req, res);
  if (!submission) return;

  const validation = AnalysisSchema.safeParse(req.body?.result);
  if (!validation.success) {
    return res.status(400).json({
      error: `Provided analysis does not match the required schema: ${validation.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`,
    });
  }

  const provider = typeof req.body?.provider === "string" ? req.body.provider : null;
  const model = typeof req.body?.model === "string" ? req.body.model : null;
  const promptVersion = typeof req.body?.promptVersion === "string" ? req.body.promptVersion : AI_PROMPT_VERSION;

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
  getChatProgress,
  analyzePastedTextForSubmission,
  getAnalyzePastedProgressForSubmission,
  analyzePastedTextStandalone,
  getAnalyzePastedProgressStandalone,
  saveChatAnalysis,
  saveStandaloneAnalysisAsSubmission,
};
