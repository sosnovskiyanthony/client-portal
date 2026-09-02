const express = require("express");
const errorController = require("../controllers/errorController");
const { clientErrorLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// Public, unauthenticated — any page's browser-side error handler can
// reach this (see frontend/js/errorMonitor.js). Rate-limited the same way
// every other public endpoint is (middleware/rateLimit.js).
router.post("/", clientErrorLimiter, asyncHandler(errorController.reportClientError));

module.exports = router;
