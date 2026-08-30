const express = require("express");
const authController = require("../controllers/authController");
const { loginLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.post("/login", loginLimiter, asyncHandler(authController.login));

module.exports = router;
