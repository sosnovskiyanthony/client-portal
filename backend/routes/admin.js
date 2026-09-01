const express = require("express");
const adminController = require("../controllers/adminController");
const { authenticate, requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { analysisLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/submissions", asyncHandler(adminController.listSubmissions));
router.get("/submissions/export", asyncHandler(adminController.exportSubmissions));
router.patch("/submissions/:id/status", asyncHandler(adminController.updateSubmissionStatus));
router.post("/submissions/:id/analyze", analysisLimiter, asyncHandler(adminController.analyzeSubmission));
router.post("/submissions/:id/draft-email", analysisLimiter, asyncHandler(adminController.draftEmail));
router.put("/submissions/:id/outcome", asyncHandler(adminController.upsertOutcome));
router.delete("/submissions/:id", asyncHandler(adminController.deleteSubmission));
router.post("/storage/signed-url", asyncHandler(adminController.getAssetSignedUrl));
router.delete("/submissions/:id/assets", asyncHandler(adminController.removeAsset));
router.post("/storage/cleanup-orphans", asyncHandler(adminController.cleanupAssets));

module.exports = router;
