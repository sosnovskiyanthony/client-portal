const Submission = require("../models/Submission");
const Analysis = require("../models/Analysis");
const ProjectOutcome = require("../models/ProjectOutcome");
const EmailDraft = require("../models/EmailDraft");
const { runAnalysis } = require("../services/runAnalysis");
const { runDraftEmail } = require("../services/draftEmail");
const { toCsv } = require("../utils/csv");
const storage = require("../services/storage");

async function listSubmissions(req, res) {
  const type = typeof req.query.type === "string" ? req.query.type : "all";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const [submissions, total] = await Promise.all([
    Submission.findPage({ type, page }),
    Submission.count({ type }),
  ]);
  const ids = submissions.map((s) => s.id);
  const [analyses, outcomes, emailDrafts] = await Promise.all([
    Analysis.findAllBySubmissionIds(ids),
    ProjectOutcome.findAllBySubmissionIds(ids),
    EmailDraft.findAllBySubmissionIds(ids),
  ]);

  res.json({
    submissions: submissions.map((s) => ({
      ...s,
      analysis: analyses[s.id] || null,
      outcome: outcomes[s.id] || null,
      emailDraft: emailDrafts[s.id] || null,
    })),
    total,
    page,
    pageSize: Submission.PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / Submission.PAGE_SIZE)),
  });
}

// Admin-only, applies to any submission type — a manually-recorded outcome
// is meaningful for an SEO or contact lead too, not just web-design.
async function upsertOutcome(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const { outcome, finalScope, actualTimeline, quotedPrice, finalPrice, featuresDelivered, notes } = req.body || {};

  let outcomeRow;
  try {
    outcomeRow = await ProjectOutcome.upsert(id, {
      outcome,
      finalScope,
      actualTimeline,
      quotedPrice,
      finalPrice,
      featuresDelivered,
      notes,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  res.json({ outcome: outcomeRow });
}

const EXPORT_HEADERS = [
  "id",
  "type",
  "status",
  "clientName",
  "email",
  "createdAt",
  "updatedAt",
  "projectDetails",
  "outcome",
  "finalScope",
  "actualTimeline",
  "quotedPrice",
  "finalPrice",
  "featuresDelivered",
  "notes",
];

// Unpaginated — respects the same type filter as the dashboard list, but
// exports every matching row in one response rather than a page at a time.
// projectDetails (which varies per submission type) is flattened to a JSON
// string column rather than split into per-type columns, so nothing about
// any submission type is lost or needs special-casing here.
async function exportSubmissions(req, res) {
  const type = typeof req.query.type === "string" ? req.query.type : "all";
  const submissions = await Submission.findAll({ type });
  const outcomes = await ProjectOutcome.findAllBySubmissionIds(submissions.map((s) => s.id));

  const rows = submissions.map((s) => {
    const o = outcomes[s.id] || {};
    return {
      id: s.id,
      type: s.type,
      status: s.status,
      clientName: s.clientName || "",
      email: s.email || "",
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
      updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
      projectDetails: s.projectDetails ? JSON.stringify(s.projectDetails) : "",
      outcome: o.outcome || "",
      finalScope: o.finalScope || "",
      actualTimeline: o.actualTimeline || "",
      quotedPrice: o.quotedPrice ?? "",
      finalPrice: o.finalPrice ?? "",
      featuresDelivered: Array.isArray(o.featuresDelivered) ? o.featuresDelivered.join("; ") : "",
      notes: o.notes || "",
    };
  });

  const csv = toCsv(rows, EXPORT_HEADERS);
  const filename = `submissions-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

// Admin-only. The bucket is private (see services/storage.js), so viewing a
// brand asset uploaded on the web-design intake means generating a
// short-lived signed URL on demand rather than storing a permanent one. The
// prefix check is defense-in-depth against this endpoint being used as a
// generic Supabase Storage proxy — every path this app itself ever writes
// starts with "brand-assets/" (see intakeController.uploadBrandAssets).
async function getAssetSignedUrl(req, res) {
  const { path } = req.body || {};
  if (typeof path !== "string" || !path.startsWith("brand-assets/")) {
    return res.status(400).json({ error: "Invalid asset path." });
  }
  if (!storage.isConfigured()) {
    return res.status(503).json({ error: "File storage is not configured on this server." });
  }

  let url;
  try {
    url = await storage.createSignedUrl(path, 300);
  } catch (err) {
    return res.status(502).json({ error: "Could not generate a signed URL for this file." });
  }
  res.json({ url });
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

// Admin-only, rate-limited (same limiter as /analyze — this is also a real
// AI call). Only ever runs once analysis has completed for this submission;
// the button that triggers this doesn't even appear in the admin UI until
// then, but this is re-validated server-side regardless.
async function draftEmail(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const analysis = await Analysis.findBySubmissionId(id);
  if (!analysis || analysis.status !== "completed") {
    return res.status(400).json({ error: "AI analysis must complete before an outreach email can be drafted." });
  }

  const existing = await EmailDraft.findBySubmissionId(id);
  if (existing && existing.status === "processing") {
    const ageMs = Date.now() - new Date(existing.updatedAt).getTime();
    if (ageMs < STALE_PROCESSING_MS) {
      return res.json({ emailDraft: existing });
    }
    // Past the threshold — treat as abandoned and fall through to retry.
  }

  const emailDraft = await runDraftEmail(submission, analysis);
  res.json({ emailDraft });
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

module.exports = {
  listSubmissions,
  updateSubmissionStatus,
  analyzeSubmission,
  upsertOutcome,
  exportSubmissions,
  draftEmail,
  getAssetSignedUrl,
};
