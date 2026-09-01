// Contracts admin API — genuinely separate from routes/admin.js (its own
// router, its own file), but gated by the exact same authenticate +
// requireAdmin middleware. This is the actual security boundary: the
// Contracts frontend page is just a public static shell like admin.html,
// so every one of these routes must enforce its own authorization
// regardless of what the UI shows or hides.
const express = require("express");
const contractController = require("../controllers/contractController");
const contractFeatureController = require("../controllers/contractFeatureController");
const contractTemplateController = require("../controllers/contractTemplateController");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { analysisLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/contracts", asyncHandler(contractController.listContracts));
router.get("/contracts/:id", asyncHandler(contractController.getContract));
router.post("/contracts/from-submission/:submissionId", asyncHandler(contractController.createContractFromSubmission));
router.patch("/contracts/:id", asyncHandler(contractController.updateContract));
router.delete("/contracts/:id", asyncHandler(contractController.deleteContract));
router.get("/contracts/:id/audit-log", asyncHandler(contractController.getContractAuditLog));
router.patch("/contracts/:id/features", asyncHandler(contractController.setContractFeatures));
router.post("/contracts/:id/features/custom", asyncHandler(contractController.addCustomFeature));
router.delete("/contracts/:id/features/:featureRowId", asyncHandler(contractController.removeContractFeature));
router.post("/contracts/:id/review", analysisLimiter, asyncHandler(contractController.reviewContract));
router.get("/contracts/:id/review/progress", asyncHandler(contractController.getContractReviewProgress));

router.get("/contract-features", asyncHandler(contractFeatureController.listFeatures));
router.post("/contract-features", asyncHandler(contractFeatureController.createFeature));
router.patch("/contract-features/:id", asyncHandler(contractFeatureController.updateFeature));
router.delete("/contract-features/:id", asyncHandler(contractFeatureController.deactivateFeature));

router.get("/contract-templates", asyncHandler(contractTemplateController.listTemplates));
router.get("/contract-templates/:id", asyncHandler(contractTemplateController.getTemplate));
router.post("/contract-templates", asyncHandler(contractTemplateController.createTemplate));
router.patch("/contract-templates/:id", asyncHandler(contractTemplateController.updateTemplate));
router.post("/contract-templates/:id/activate", asyncHandler(contractTemplateController.activateTemplate));

module.exports = router;
