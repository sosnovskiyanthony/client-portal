const Submission = require("../models/Submission");
const Analysis = require("../models/Analysis");
const { runAnalysis } = require("../services/runAnalysis");

async function listSubmissions(req, res) {
  const type = typeof req.query.type === "string" ? req.query.type : "all";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const [submissions, total] = await Promise.all([
    Submission.findPage({ type, page }),
    Submission.count({ type }),
  ]);
  const analyses = await Analysis.findAllBySubmissionIds(submissions.map((s) => s.id));

  res.json({
    submissions: submissions.map((s) => ({ ...s, analysis: analyses[s.id] || null })),
    total,
    page,
    pageSize: Submission.PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / Submission.PAGE_SIZE)),
  });
}

// Mirrors the STUCK_THRESHOLD_MS used in frontend/js/admin.js to decide when
// a "processing" row shows a retry button instead of a passive message —
// same reasoning applies here: Ollama's own request timeout is 5 minutes, so
// anything still "processing" past 6 has no live request behind it anymore.
const STALE_PROCESSING_MS = 6 * 60 * 1000;

// Admin-only (see routes/admin.js: authenticate + requireAdmin run first),
// rate-limited, and works whether this is the first analysis attempt or a
// re-analysis — runAnalysis()'s upsert makes them the same operation.
//
// If an analysis is already genuinely in flight for this submission (a real
// request that hasn't had time to finish yet — not an abandoned one), this
// does NOT start a second one. It just returns the existing in-progress row,
// so reloading the page, closing a tab, or clicking Analyze again from a
// second tab always shows the true current state instead of racing a
// duplicate request that would silently overwrite whichever finishes last.
async function analyzeSubmission(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }
  if (submission.type !== "web-design") {
    return res.status(400).json({ error: "AI analysis is only available for web-design submissions." });
  }

  const existing = await Analysis.findBySubmissionId(id);
  if (existing && existing.status === "processing") {
    const ageMs = Date.now() - new Date(existing.updatedAt).getTime();
    if (ageMs < STALE_PROCESSING_MS) {
      return res.json({ analysis: existing });
    }
    // Past the threshold — treat as abandoned (e.g. a server restart
    // interrupted it) and fall through to start a fresh run.
  }

  const analysis = await runAnalysis(submission);
  res.json({ analysis });
}

async function updateSubmissionStatus(req, res) {
  const id = Number(req.params.id);
  const { status } = req.body || {};

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  if (!Submission.VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${Submission.VALID_STATUSES.join(", ")}` });
  }

  const existing = await Submission.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const submission = await Submission.updateStatus(id, status);
  res.json({ submission });
}

module.exports = { listSubmissions, updateSubmissionStatus, analyzeSubmission };
