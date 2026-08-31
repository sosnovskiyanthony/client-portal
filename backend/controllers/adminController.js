const Submission = require("../models/Submission");
const Analysis = require("../models/Analysis");
const { runAnalysis } = require("../services/runAnalysis");

async function listSubmissions(req, res) {
  const submissions = await Submission.findAll();
  const analyses = await Analysis.findAllBySubmissionIds(submissions.map((s) => s.id));
  res.json({
    submissions: submissions.map((s) => ({ ...s, analysis: analyses[s.id] || null })),
  });
}

// Admin-only (see routes/admin.js: authenticate + requireAdmin run first),
// rate-limited, and works whether this is the first analysis attempt or a
// re-analysis — runAnalysis()'s upsert makes them the same operation.
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
