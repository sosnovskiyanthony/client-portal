const express = require("express");
const contactController = require("../controllers/contactController");
const { submissionLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.post("/", submissionLimiter, asyncHandler(contactController.submitContact));

module.exports = router;
