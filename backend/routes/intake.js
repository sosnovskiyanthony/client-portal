const express = require("express");
const intakeController = require("../controllers/intakeController");
const { submissionLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.use(submissionLimiter);

router.post("/web-design", asyncHandler(intakeController.webDesign));
router.post("/seo", asyncHandler(intakeController.seo));

module.exports = router;
