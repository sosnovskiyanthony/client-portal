const express = require("express");
const contactController = require("../controllers/contactController");
const { submissionLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/", submissionLimiter, contactController.submitContact);

module.exports = router;
