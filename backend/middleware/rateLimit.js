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

// The AI analysis endpoint is already authenticated + admin-only (see
// routes/admin.js), so a public visitor can never reach it at all — this is
// defense-in-depth against a compromised/leaked admin token or accidental
// rapid re-clicking, not the primary control.
const analysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many analysis requests. Please try again later." },
});

// Brand-asset uploads (web-design intake only) — public and unauthenticated,
// so this stays deliberately separate from submissionLimiter: a legitimate
// visitor attaching several files across multiple selections shouldn't burn
// through the same budget their final form submit (or a later contact-form
// visit, since submissionLimiter is shared across all of /api/intake/* +
// /api/contact) needs. Still bounded — each request can carry up to 5 files
// x 15MB (see routes/intake.js), so this caps a single IP at roughly
// 1.5GB/hour of attempted uploads, not unlimited.
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many upload requests. Please try again later." },
});

// AI chat is also admin-only (defense-in-depth, same reasoning as
// analysisLimiter), but a real back-and-forth conversation naturally makes
// many more calls than one analysis click — 20/hour (analysisLimiter's cap)
// would make a normal conversation likely to hit the ceiling mid-discussion.
// Still bounded, just sized for how chat is actually used.
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many chat requests. Please try again later." },
});

module.exports = { loginLimiter, submissionLimiter, analysisLimiter, uploadLimiter, chatLimiter };
