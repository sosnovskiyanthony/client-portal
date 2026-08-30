const rateLimit = require("express-rate-limit");

// Login is the highest-value target for brute-forcing — keep this tight.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in a few minutes." },
});

// Public intake/contact endpoints — generous enough for a real visitor
// filling out a form more than once, tight enough to blunt spam scripts.
const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions from this device. Please try again later." },
});

module.exports = { loginLimiter, submissionLimiter };
