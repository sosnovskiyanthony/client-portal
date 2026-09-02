// Declarative capability map for every real AI operation in
// ai/aiService.js — deterministic documentation of what each operation is
// and isn't allowed to do, consumed by the AI reviewer's own system prompt
// (ai/guardianPrompt.js) and the admin dashboard. The application never
// asks the AI whether an operation is allowed — this map, and the actual
// code, are the only authorities.
//
// As of this writing every operation has execute/modifyCode/
// modifyInfrastructure all false — there is no fs/child_process/exec/spawn
// anywhere near the AI path (verified by direct code inspection, not
// assumed) and the only "tool" any operation can invoke is `web_search`
// (ai/researchTool.js — a read-only Tavily HTTP call), gated by
// ai/providers/ollamaProvider.js's ALLOWED_TOOL_NAMES allowlist. `write`
// below refers to what the AI's OUTPUT is used to populate by the
// *calling* service/controller after validation — the AI service itself
// never writes to the database; see e.g. services/runAnalysis.js actually
// calling models/Analysis.js after aiService.analyzeSubmission() returns.
const AI_CAPABILITIES = {
  analyzeSubmission: {
    read: ["submission.projectDetails"],
    write: ["submission_analyses (via services/runAnalysis.js, after validation)"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
  },
  analyzeServicesSubmission: {
    read: ["submission.projectDetails"],
    write: ["submission_analyses (via services/runAnalysis.js, after validation)"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
  },
  analyzeRawText: {
    read: ["admin-pasted raw text"],
    write: ["submission_chats (only if the admin explicitly saves it — chatController.saveChatAnalysis)"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
  },
  chatReply: {
    read: ["submission.projectDetails", "submission_analyses.result", "submission_chats history"],
    write: ["submission_chats (via services/runChat.js)"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
  },
  chatReplyWithResearch: {
    read: ["submission.projectDetails", "submission_analyses.result", "submission_chats history"],
    write: ["submission_chats (via services/runChat.js)"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
    tools: ["web_search (read-only, Tavily HTTP search — see ai/providers/ollamaProvider.js's ALLOWED_TOOL_NAMES)"],
  },
  updateAnalysisFromConversation: {
    read: ["current analysis result", "sanitized intake", "chat conversation turns"],
    write: ["nothing automatically — result returned to the admin, only saved if the admin explicitly does so"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
  },
  draftEmail: {
    read: ["submission", "completed analysis"],
    write: ["email_drafts (via services/draftEmail.js, after validation)"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
  },
  reviewContract: {
    read: ["admin-approved contract data"],
    write: ["nothing automatically — result returned to the admin"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
  },
  generateContract: {
    read: ["admin-approved contract data", "contract template sections"],
    write: ["nothing automatically — result returned to the admin, only saved if the admin explicitly does so"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
  },
  reviewCodeChange: {
    read: ["git diff", "changed file list", "matched test file contents"],
    write: ["nothing — advisory findings only, never applied automatically (see guardian/reviewCli.js)"],
    execute: false,
    modifyCode: false,
    modifyInfrastructure: false,
  },
};

function getCapabilities(operationName) {
  return AI_CAPABILITIES[operationName] || null;
}

module.exports = { AI_CAPABILITIES, getCapabilities };
