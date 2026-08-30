const express = require("express");
const adminController = require("../controllers/adminController");
const { authenticate, requireAdmin } = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/submissions", asyncHandler(adminController.listSubmissions));
router.patch("/submissions/:id/status", asyncHandler(adminController.updateSubmissionStatus));

module.exports = router;
