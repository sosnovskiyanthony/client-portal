const express = require("express");
const adminController = require("../controllers/adminController");
const chatController = require("../controllers/chatController");
const guardianController = require("../controllers/guardianController");
const { authenticate, requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { analysisLimiter, chatLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/submissions", asyncHandler(adminController.listSubmissions));
router.get("/submissions/export", asyncHandler(adminController.exportSubmissions));
router.patch("/submissions/:id/status", asyncHandler(adminController.updateSubmissionStatus));
router.post("/submissions/:id/analyze", analysisLimiter, asyncHandler(adminController.analyzeSubmission));
router.get("/submissions/:id/analyze/progress", asyncHandler(adminController.getAnalysisProgress));
router.post("/submissions/:id/draft-email", analysisLimiter, asyncHandler(adminController.draftEmail));
router.get("/submissions/:id/draft-email/progress", asyncHandler(adminController.getEmailDraftProgress));
router.put("/submissions/:id/outcome", asyncHandler(adminController.upsertOutcome));
router.delete("/submissions/:id", asyncHandler(adminController.deleteSubmission));
router.post("/storage/signed-url", asyncHandler(adminController.getAssetSignedUrl));
router.delete("/submissions/:id/assets", asyncHandler(adminController.removeAsset));
router.post("/storage/cleanup-orphans", asyncHandler(adminController.cleanupAssets));
router.get("/ollama/status", asyncHandler(adminController.getOllamaStatus));
router.post("/ollama/start", asyncHandler(adminController.startOllamaRemote));
router.post("/ollama/stop", asyncHandler(adminController.stopOllamaRemote));

// AI chat — an interface to the same analysis pipeline the routes above
// already use (see ai/aiService.js's chatReply/analyzeRawText). The
// standalone routes below (/chat/...) don't overlap with the :id-scoped
// ones further down (/submissions/:id/chat/...) — different top-level path
// segment, so route registration order between the two groups doesn't
// matter here.
router.post("/chat/analyze", chatLimiter, asyncHandler(chatController.analyzePastedTextStandalone));
router.get("/chat/analyze/progress/:requestId", chatController.getAnalyzePastedProgressStandalone);
router.post("/chat/analyze/save-as-submission", asyncHandler(chatController.saveStandaloneAnalysisAsSubmission));
router.get("/chat/research-status", chatController.getResearchStatus);

router.get("/submissions/:id/chat", asyncHandler(chatController.getChatHistory));
router.post("/submissions/:id/chat", chatLimiter, asyncHandler(chatController.sendChatMessage));
router.post("/submissions/:id/chat/regenerate", chatLimiter, asyncHandler(chatController.regenerateChatReply));
router.post("/submissions/:id/chat/update-analysis", chatLimiter, asyncHandler(chatController.updateAnalysisFromChat));
router.get("/submissions/:id/chat/update-analysis/progress", chatController.getAnalysisUpdateProgress);
router.get("/submissions/:id/chat/progress", chatController.getChatProgress);
router.post("/submissions/:id/chat/analyze", chatLimiter, asyncHandler(chatController.analyzePastedTextForSubmission));
router.get("/submissions/:id/chat/analyze/progress", chatController.getAnalyzePastedProgressForSubmission);
router.post("/submissions/:id/chat/analyze/save", asyncHandler(chatController.saveChatAnalysis));

// BrindLeaf Guardian — production diagnostics (DB/storage/Ollama/Resend/
// Tavily) and its short history. See controllers/guardianController.js's
// module comment for why this is diagnostics-only, not the CI-time
// deterministic checks. No dedicated limiter: same lightweight-status-check
// class as /ollama/status above, not an AI-generation call.
router.get("/guardian/diagnostics", asyncHandler(guardianController.getDiagnostics));
router.post("/guardian/run", asyncHandler(guardianController.runGuardianCheck));
router.get("/guardian/history", asyncHandler(guardianController.getGuardianHistory));

module.exports = router;
