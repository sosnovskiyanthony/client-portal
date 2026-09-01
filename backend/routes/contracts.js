// Contracts admin API — genuinely separate from routes/admin.js (its own
// router, its own file), but gated by the exact same authenticate +
// requireAdmin middleware. This is the actual security boundary: the
// Contracts frontend page is just a public static shell like admin.html,
// so every one of these routes must enforce its own authorization
// regardless of what the UI shows or hides.
const express = require("express");
const contractController = require("../controllers/contractController");
const { authenticate, requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/contracts", asyncHandler(contractController.listContracts));
router.get("/contracts/:id", asyncHandler(contractController.getContract));
router.post("/contracts/from-submission/:submissionId", asyncHandler(contractController.createContractFromSubmission));
router.patch("/contracts/:id", asyncHandler(contractController.updateContract));
router.delete("/contracts/:id", asyncHandler(contractController.deleteContract));
router.get("/contracts/:id/audit-log", asyncHandler(contractController.getContractAuditLog));

module.exports = router;
