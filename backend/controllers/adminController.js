const Submission = require("../models/Submission");

function listSubmissions(req, res) {
  res.json({ submissions: Submission.findAll() });
}

function updateSubmissionStatus(req, res) {
  const id = Number(req.params.id);
  const { status } = req.body || {};

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  if (!Submission.VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${Submission.VALID_STATUSES.join(", ")}` });
  }

  const existing = Submission.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const submission = Submission.updateStatus(id, status);
  res.json({ submission });
}

module.exports = { listSubmissions, updateSubmissionStatus };
