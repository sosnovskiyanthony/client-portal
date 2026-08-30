const express = require("express");
const intakeController = require("../controllers/intakeController");
const { submissionLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.use(submissionLimiter);

router.post("/web-design", intakeController.webDesign);
router.post("/seo", intakeController.seo);

module.exports = router;
