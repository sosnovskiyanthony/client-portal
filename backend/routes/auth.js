const express = require("express");
const authController = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.post("/login", loginLimiter, asyncHandler(authController.login));
// authenticate() applied directly to this one route rather than at the
// router level (unlike routes/admin.js/contracts.js) — /login above must
// stay reachable without a token.
router.post("/logout", authenticate, asyncHandler(authController.logout));

module.exports = router;
