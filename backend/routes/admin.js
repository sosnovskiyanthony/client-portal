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
router.get("/submissions/:id/context", asyncHandler(adminController.getSubmissionContext));
router.post("/submissions/:id/context/interpret", analysisLimiter, asyncHandler(adminController.interpretSubmissionContext));
router.get("/submissions/:id/context/interpret/progress", asyncHandler(adminController.getContextInterpretProgress));
router.post("/submissions/:id/context/apply", asyncHandler(adminController.applyContextChanges));
router.get("/submissions/:id/context/reanalysis/progress", asyncHandler(adminController.getContextReanalysisProgress));
router.get("/submissions/:id/pricing", asyncHandler(adminController.getPricingHistory));
router.post("/submissions/:id/pricing/generate", analysisLimiter, asyncHandler(adminController.generatePricingStrategy));
router.get("/submissions/:id/pricing/progress", asyncHandler(adminController.getPricingProgress));
router.put("/submissions/:id/outcome", asyncHandler(adminController.upsertOutcome));
router.delete("/submissions/:id", asyncHandler(adminController.deleteSubmission));
router.post("/submissions/:id/storage/signed-url", asyncHandler(adminController.getAssetSignedUrl));
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

// AI safety control plane — see guardian/aiControl.js. Same JWT+admin gate
// as everything else on this router; no dedicated rate limiter, matching
// the other lightweight Guardian/Ollama-control routes above (these are
// state reads/writes, not AI-generation calls).
router.get("/guardian/ai/state", asyncHandler(guardianController.getAiControlState));
router.post("/guardian/ai/disable", asyncHandler(guardianController.disableAi));
router.post("/guardian/ai/lockdown", asyncHandler(guardianController.lockdownAi));
router.post("/guardian/ai/enable", asyncHandler(guardianController.enableAi));
router.get("/guardian/events", asyncHandler(guardianController.getSecurityEvents));
router.post("/guardian/events/:id/acknowledge", asyncHandler(guardianController.acknowledgeSecurityEvent));

// Security Center (see frontend/admin-security.html, js/security.js) — the
// aggregate status/version/consistency panel, the filtered+paginated
// activity feed, and deployment history. All thin adapters over the exact
// same Guardian modules the routes above already use — no second system,
// no second auth path. Same no-dedicated-limiter reasoning as the routes
// above: state reads, not AI-generation calls.
router.get("/security/status", asyncHandler(guardianController.getSecurityStatus));
router.get("/security/events", asyncHandler(guardianController.getSecurityEventsPage));
router.get("/security/deployments", asyncHandler(guardianController.getDeploymentHistory));

module.exports = router;
