const Submission = require("../models/Submission");
const Analysis = require("../models/Analysis");
const ProjectOutcome = require("../models/ProjectOutcome");
const EmailDraft = require("../models/EmailDraft");
const Contract = require("../models/Contract");
const { runAnalysis } = require("../services/runAnalysis");
const { runDraftEmail } = require("../services/draftEmail");
const { runContextInterpretation, buildCurrentContext } = require("../services/runContextInterpretation");
const { runContextReanalysis } = require("../services/runContextReanalysis");
const { applyContextChanges: applyContextChangesTx, ContextApplyError } = require("../services/applyContextChanges");
const SubmissionContextChange = require("../models/SubmissionContextChange");
const SubmissionContextFact = require("../models/SubmissionContextFact");
const { ContextChangeSchema } = require("../ai/contextInterpretSchema");
const { AiAnalysisError } = require("../ai/errors");
const { toCsv } = require("../utils/csv");
const storage = require("../services/storage");
const { BRAND_ASSET_PATH_RE } = require("../lib/validators");
const { isValidServiceSlug } = require("../lib/services");
const { cleanupOrphanedAssets } = require("../services/orphanCleanup");
const { tailscaleDispatcher } = require("../lib/tailscaleDispatcher");
const analysisProgress = require("../lib/analysisProgress");
const env = require("../config/env");

// A search box, not a text field with real content limits elsewhere in the
// app — cap it the same defensive way (see ai/prompt.js's MAX_* constants)
// so an arbitrarily long query string can't turn into an unnecessarily
// expensive ILIKE scan.
const MAX_SEARCH_CHARS = 200;

async function listSubmissions(req, res) {
  const type = typeof req.query.type === "string" ? req.query.type : "all";
  // Filters the new services array (see models/Submission.js) — a
  // different query dimension from `type`, since a single 'services'
  // submission can match more than one of these (frontend/js/admin.js's
  // new service-based filter pills use this, not `type`).
  const service = typeof req.query.service === "string" && isValidServiceSlug(req.query.service) ? req.query.service : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.slice(0, MAX_SEARCH_CHARS) : undefined;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const [submissions, total] = await Promise.all([
    Submission.findPage({ type, service, search, page }),
    Submission.count({ type, service, search }),
  ]);
  const ids = submissions.map((s) => s.id);
  const [analyses, outcomes, emailDrafts, contracts] = await Promise.all([
    Analysis.findAllBySubmissionIds(ids),
    ProjectOutcome.findAllBySubmissionIds(ids),
    EmailDraft.findAllBySubmissionIds(ids),
    Contract.findAllBySubmissionIds(ids),
  ]);

  res.json({
    submissions: submissions.map((s) => ({
      ...s,
      analysis: analyses[s.id] || null,
      outcome: outcomes[s.id] || null,
      emailDraft: emailDrafts[s.id] || null,
      // Array, not a single object — unlike analysis/outcome/emailDraft,
      // more than one contract can exist per submission (a re-negotiated
      // deal). See models/Contract.js's findAllBySubmissionIds.
      contracts: contracts[s.id] || [],
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

  // ProjectOutcome.upsert treats undefined/null/"" as "clear this field" —
  // anything else must be a real, non-negative number. Without this, a
  // non-numeric value (e.g. a stray string) reaches the NUMERIC column as a
  // raw, unclassified Postgres error (a generic 500, not a clear 400), and a
  // negative price would otherwise be stored silently.
  for (const [field, value] of [["quotedPrice", quotedPrice], ["finalPrice", finalPrice]]) {
    const isEmpty = value === undefined || value === null || value === "";
    if (!isEmpty && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      return res.status(400).json({ error: `${field} must be a non-negative number.` });
    }
  }

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
  "services",
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
  const service = typeof req.query.service === "string" && isValidServiceSlug(req.query.service) ? req.query.service : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.slice(0, MAX_SEARCH_CHARS) : undefined;
  const submissions = await Submission.findAll({ type, service, search });
  const outcomes = await ProjectOutcome.findAllBySubmissionIds(submissions.map((s) => s.id));

  const rows = submissions.map((s) => {
    const o = outcomes[s.id] || {};
    return {
      id: s.id,
      type: s.type,
      services: Array.isArray(s.services) ? s.services.join("; ") : "",
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
  const filename = `submissions-${service || type}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

// Admin-only. The bucket is private (see services/storage.js), so viewing a
// brand asset uploaded on the web-design intake means generating a
// short-lived signed URL on demand rather than storing a permanent one.
// BRAND_ASSET_PATH_RE is defense-in-depth against this endpoint being used
// as a generic Supabase Storage proxy — it matches only the exact shape
// every path this app itself ever writes has (see lib/validators.js; a bare
// prefix check here was previously bypassable with a path like
// "brand-assets/../../../etc/passwd", which also starts with
// "brand-assets/"). Submission-scoped (mirrors removeAsset's exact
// ownership check below) — a Guardian security review found the previous
// route (POST /storage/signed-url, no submission id) let any valid admin
// JWT request a signed URL for ANY well-formed brand-asset UUID path, not
// just one actually attached to the submission being viewed. Not a live
// incident (this app has exactly one admin, and asset paths are random
// UUIDs, not guessable), but real defense-in-depth: a leaked/stolen admin
// token, or a future bug elsewhere, should not be able to enumerate
// arbitrary client files just because it can enumerate UUIDs.
async function getAssetSignedUrl(req, res) {
  const id = Number(req.params.id);
  const { path } = req.body || {};
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  if (typeof path !== "string" || !BRAND_ASSET_PATH_RE.test(path)) {
    return res.status(400).json({ error: "Invalid asset path." });
  }
  if (!storage.isConfigured()) {
    return res.status(503).json({ error: "File storage is not configured on this server." });
  }

  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const assets = (submission.projectDetails && submission.projectDetails.brandAssets) || [];
  if (!Array.isArray(assets) || !assets.some((a) => a && a.path === path)) {
    return res.status(404).json({ error: "This submission has no attached file at that path." });
  }

  let url;
  try {
    url = await storage.createSignedUrl(path, 300);
  } catch (err) {
    return res.status(502).json({ error: "Could not generate a signed URL for this file." });
  }
  res.json({ url });
}

// Admin-only, permanent and irreversible. FK ON DELETE CASCADE handles the
// related analysis/outcome/email-draft rows automatically (see
// config/database.js) — this only needs to also clean up any attached
// brand-asset files, since those live in Supabase Storage, not the database.
// Best-effort on the storage side: a storage hiccup must never block
// honoring the deletion request itself, and even if it silently fails here,
// the file becomes unreferenced the moment the row is gone — the orphaned-
// asset cleanup job (services/orphanCleanup.js) catches it either way.
async function deleteSubmission(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }

  // contracts.submission_id is ON DELETE CASCADE (see config/database.js) —
  // without this check, deleting a submission would silently destroy any
  // finalized contracts through the DB relationship, completely bypassing
  // contractController.deleteContract's own "a finalized contract can
  // never be deleted" protection. Caught in review, not a live incident —
  // a finalized contract is meant to be the authoritative record of an
  // agreement; it must never be destroyable through a side door. Draft-
  // stage (non-finalized) contracts are still fine to cascade-delete, same
  // as the direct endpoint allows.
  const existingContracts = await Contract.findAllBySubmissionIds([id]);
  const hasFinalizedContract = (existingContracts[id] || []).some((c) => c.finalizedAt);
  if (hasFinalizedContract) {
    return res.status(400).json({ error: "This submission has a finalized contract and cannot be deleted. Delete or reassign the contract first." });
  }

  const assets = (submission.projectDetails && submission.projectDetails.brandAssets) || [];
  if (Array.isArray(assets) && assets.length > 0 && storage.isConfigured()) {
    try {
      await storage.deleteFiles(assets.map((a) => a && a.path).filter(Boolean));
    } catch (err) {
      console.error(`[deleteSubmission] Failed to delete storage files for submission #${id}:`, err);
    }
  }

  await Submission.deleteById(id);
  res.status(204).end();
}

// Admin-only. Removes one attached file from a submission without deleting
// the submission itself — the reverse of uploadBrandAssets: drops the entry
// from projectDetails.brandAssets and best-effort deletes the underlying
// Supabase object (same reasoning as deleteSubmission above — the file is
// unreferenced either way once this returns, so a failed storage call still
// gets caught by the orphan-cleanup job later).
async function removeAsset(req, res) {
  const id = Number(req.params.id);
  const { path } = req.body || {};
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  if (typeof path !== "string" || !BRAND_ASSET_PATH_RE.test(path)) {
    return res.status(400).json({ error: "Invalid asset path." });
  }

  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const assets = (submission.projectDetails && submission.projectDetails.brandAssets) || [];
  if (!Array.isArray(assets) || !assets.some((a) => a && a.path === path)) {
    return res.status(404).json({ error: "This submission has no attached file at that path." });
  }

  if (storage.isConfigured()) {
    try {
      await storage.deleteFiles([path]);
    } catch (err) {
      console.error(`[removeAsset] Failed to delete storage file ${path} for submission #${id}:`, err);
    }
  }

  const updatedAssets = assets.filter((a) => !a || a.path !== path);
  const updated = await Submission.updateProjectDetails(id, { ...submission.projectDetails, brandAssets: updatedAssets });
  res.json({ submission: updated });
}

// Admin-only, admin-triggered (no automatic schedule — see
// services/orphanCleanup.js). Deletes storage objects no submission
// references, past a 24h safety window.
async function cleanupAssets(req, res) {
  if (!storage.isConfigured()) {
    return res.status(503).json({ error: "File storage is not configured on this server." });
  }
  try {
    const result = await cleanupOrphanedAssets();
    res.json(result);
  } catch (err) {
    console.error("[cleanupAssets] Cleanup failed:", err);
    res.status(502).json({ error: "Cleanup failed. Please try again." });
  }
}

// Mirrors the STUCK_THRESHOLD_MS used in frontend/js/admin.js to decide when
// a "processing" row shows a retry button instead of a passive message —
// same reasoning applies here: ollamaProvider.js's own REQUEST_TIMEOUT_MS is
// 8 minutes, so this needs real margin above that or a still-genuinely-
// running analysis could get treated as abandoned while it's still working.
const STALE_PROCESSING_MS = 10 * 60 * 1000;

// Admin-only (see routes/admin.js: authenticate + requireAdmin run first),
// rate-limited, and works whether this is the first analysis attempt or a
// re-analysis — runAnalysis()'s upsert makes them the same operation.
//
// If an analysis is already genuinely in flight for this submission (a real
// request that hasn't had time to finish yet — not an abandoned one), this
// does NOT start a second one — reloading the page, closing a tab, or
// clicking Analyze again from a second tab always converges on the same
// real run instead of racing a duplicate that would silently overwrite
// whichever finishes last.
//
// Responds immediately (202) and runs the actual analysis in the
// background, reporting the eventual result through getAnalysisProgress
// below instead of holding this request open for it — the same fire-and-
// poll shape as chatController.js's paste-and-analyze routes, and for the
// same reason: a real production incident (2026-09-02/03) showed something
// ahead of this app dropping a long-held client connection well under
// Ollama's own multi-minute budget, so the browser saw a stale-looking
// timeout even when the real analysis was still genuinely working. No
// single request in this flow needs to survive more than an instant.
//
// runAnalysis() itself never throws (see services/runAnalysis.js) — every
// outcome, success or failure, is written to submission_analyses as a
// normal completed/failed row, so nothing here needs its own error
// classification the way chatController's routes do.
async function analyzeSubmission(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }
  if (submission.type !== "web-design" && submission.type !== "services") {
    return res.status(400).json({ error: "AI analysis is only available for web-design and services submissions." });
  }

  const existing = await Analysis.findBySubmissionId(id);
  if (existing && existing.status === "processing") {
    const ageMs = Date.now() - new Date(existing.updatedAt).getTime();
    if (ageMs < STALE_PROCESSING_MS) {
      // Already genuinely running — nothing new to start. The client polls
      // getAnalysisProgress the same way regardless of which branch got it
      // here, so there's nothing else to distinguish in the response.
      return res.status(202).json({ started: false });
    }
    // Past the threshold — treat as abandoned (e.g. a server restart
    // interrupted it) and fall through to start a fresh run.
  }

  res.status(202).json({ started: true });
  runAnalysis(submission).catch((err) => {
    // Last-resort net, not the expected path — runAnalysis is designed to
    // catch and record every real failure itself. A bug there throwing
    // anyway should log loudly, not take the process down.
    console.error(`[adminController] Unexpected error running background analysis for submission ${id}:`, err);
  });
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

// Polled by the dashboard (see frontend/js/admin.js's tickElapsedLabels)
// while an analysis/draft is in flight from this tab, to show real,
// backend-confirmed stages instead of a single static "Analyzing…" label.
// Cheap in-memory read (see lib/analysisProgress.js) — no DB round trip, no
// rate limit needed. Always 200; { active: false } just means nothing is
// currently running for this submission (finished, failed, or never
// started), which is a normal state, not an error.
function makeProgressHandler(kind) {
  return async function handler(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid submission id." });
    }
    const progress = analysisProgress.get(kind, id);
    if (!progress) {
      return res.json({ active: false });
    }
    res.json({ active: true, ...progress });
  };
}

// Analysis gets its own handler rather than makeProgressHandler("analysis")
// above — unlike an email draft (which the client still awaits directly,
// see draftEmail above), analyzeSubmission now responds before the real
// work even starts (see its own comment), so this is the only place the
// eventual result — success or failure — ever reaches the browser. Once
// nothing is running in this process for this submission, it falls back to
// the durable submission_analyses row itself (unlike chatController's
// paste-and-analyze routes, which have no other persistence to fall back
// on for their standalone case — see lib/analysisProgress.js's complete()).
async function getAnalysisProgress(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  const progress = analysisProgress.get("analysis", id);
  if (progress) {
    return res.json({ active: true, stage: progress.stage, model: progress.model });
  }

  const analysis = await Analysis.findBySubmissionId(id);
  if (!analysis) {
    return res.json({ active: false });
  }
  if (analysis.status === "completed" || analysis.status === "failed") {
    return res.json({ active: false, done: true, analysis });
  }
  // status is "pending" or "processing" with nothing running in this
  // process — either a very tight timing window right after the
  // background task started but before its own analysisProgress.start()
  // call landed (still genuinely fine, report active), or a server
  // restart interrupted a real run and nothing is left to ever finish it
  // (same staleness threshold analyzeSubmission itself uses to decide
  // "abandoned" — without this, a poller would wait out its own ceiling
  // with no real answer, same gap chat.js's POLL_TIMEOUT_MS exists for).
  const ageMs = Date.now() - new Date(analysis.updatedAt).getTime();
  if (ageMs < STALE_PROCESSING_MS) {
    return res.json({ active: true, stage: "preparing" });
  }
  return res.json({
    active: false,
    done: true,
    error: "Analysis was interrupted (e.g. a server restart) and never completed. Try analyzing again.",
  });
}

const getEmailDraftProgress = makeProgressHandler("email");

// "Add Context" — interpretation step. Turns an admin's plain-English note
// about a submission into a structured, reviewable proposal (see
// ai/contextInterpretSchema.js); writes nothing (see guardian/rules.js's
// ai-context-interpret-propose-only rule). Fire-and-poll from the start —
// same reasoning as chatController.js's paste-and-analyze routes and
// contractController.js's interpretContractEditInstruction.
async function interpretSubmissionContext(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }
  if (submission.type !== "web-design" && submission.type !== "services") {
    return res.status(400).json({ error: "Add Context is only available for web-design and services submissions." });
  }
  const analysis = await Analysis.findBySubmissionId(id);
  if (!analysis || analysis.status !== "completed") {
    return res.status(400).json({ error: "Run AI analysis for this submission before adding context — there's nothing yet to recalculate." });
  }

  const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim() : "";
  if (!instruction) {
    return res.status(400).json({ error: "An instruction is required." });
  }

  // Checked against status === "active" specifically, not mere presence —
  // this kind uses analysisProgress.complete() (see
  // services/runContextInterpretation.js's caller below), which keeps a
  // finished result retrievable for RESULT_TTL_MS after it's done. A bare
  // truthiness check here would incorrectly 409 a legitimate new attempt
  // for up to that whole window just because the previous result hasn't
  // been polled-and-drained yet.
  const existingProgress = analysisProgress.get("context-interpret", id);
  if (existingProgress && existingProgress.status === "active") {
    return res.status(409).json({ error: "An interpretation is already in progress for this submission." });
  }

  res.status(202).json({ started: true });

  try {
    const result = await runContextInterpretation(submission, instruction);
    let changeRecord = null;
    if (!result.clarificationNeeded && result.proposedChanges.length > 0) {
      changeRecord = await SubmissionContextChange.createPendingReview(id, {
        rawInstruction: instruction,
        interpretation: result,
        createdBy: req.user.sub,
      });
    }
    analysisProgress.complete("context-interpret", id, { ok: true, result, changeRecord, instruction });
  } catch (err) {
    if (err instanceof AiAnalysisError) {
      analysisProgress.complete("context-interpret", id, { ok: false, error: err.message, code: err.code });
    } else {
      console.error(`[adminController] Unexpected error during background context interpretation (submission ${id}):`, err);
      analysisProgress.complete("context-interpret", id, { ok: false, error: "Something went wrong interpreting that note.", code: "internal_error" });
    }
  }
}

function getContextInterpretProgress(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  const progress = analysisProgress.get("context-interpret", id);
  if (!progress) return res.json({ active: false });
  if (progress.status === "done") return res.json({ active: false, done: true, ...progress.outcome });
  return res.json({ active: true, stage: progress.stage });
}

// "Add Context" — apply step. The ONLY code path that ever writes
// submission context as a result of the AI interpretation, and only for
// changes the admin explicitly approved individually (guardian/rules.js's
// ai-context-interpret-propose-only rule). The transactional write itself
// is fast (no AI call), so this responds synchronously; automatic
// reanalysis is then kicked off in the background separately (see
// getContextReanalysisProgress) rather than making this response wait on
// a second, slower AI call.
async function applyContextChanges(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const { changeRecordId, changes, rejectedChanges } = req.body || {};
  const recordId = Number(changeRecordId);
  if (!Number.isInteger(recordId)) {
    return res.status(400).json({ error: "A valid changeRecordId is required." });
  }
  const changeRecord = await SubmissionContextChange.findById(recordId);
  if (!changeRecord || changeRecord.submissionId !== id) {
    return res.status(404).json({ error: "Context change proposal not found for this submission." });
  }
  if (changeRecord.status !== "pending_review") {
    return res.status(400).json({ error: `This proposal was already ${changeRecord.status}.` });
  }

  if (!Array.isArray(changes) || changes.length === 0) {
    await SubmissionContextChange.markRejected(recordId);
    return res.json({ submission, rejected: true });
  }

  const parsedChanges = [];
  for (const change of changes) {
    const parsed = ContextChangeSchema.safeParse(change);
    if (!parsed.success) {
      return res.status(400).json({ error: "One or more approved changes are malformed." });
    }
    parsedChanges.push(parsed.data);
  }

  let outcome;
  try {
    outcome = await applyContextChangesTx({
      submissionId: id,
      changeRecordId: recordId,
      approvedChanges: parsedChanges,
      rawInstruction: changeRecord.rawInstruction,
      actorUserId: req.user.sub,
    });
  } catch (err) {
    if (err instanceof ContextApplyError) {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    throw err;
  }

  // Trigger automatic reanalysis in the background — only meaningful once
  // an analysis exists to revise (interpretSubmissionContext above already
  // requires one before an interpretation can even start, so this should
  // always be true in practice; re-checked here defensively).
  const currentAnalysis = await Analysis.findBySubmissionId(id);
  let reanalysisTriggered = false;
  if (currentAnalysis && currentAnalysis.status === "completed") {
    reanalysisTriggered = true;
    runContextReanalysis(outcome.submission, currentAnalysis.result, parsedChanges, outcome.contextVersion).catch((err) => {
      console.error(`[adminController] Unexpected error running background context reanalysis for submission ${id}:`, err);
    });
  }

  res.json({ submission: outcome.submission, changeRecord: outcome.changeRecord, contextVersion: outcome.contextVersion, reanalysisTriggered, rejectedChangeCount: Array.isArray(rejectedChanges) ? rejectedChanges.length : 0 });
}

// Checks analysisProgress's own done-outcome first (see
// services/runContextReanalysis.js — a failed reanalysis attempt is
// recorded there via complete(), specifically so it doesn't just vanish
// into a server log while the dashboard silently keeps showing stale
// data with no explanation), then falls back to the durable
// submission_analyses row once nothing is running in this process for it
// anymore, same reasoning as getAnalysisProgress above.
async function getContextReanalysisProgress(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  const progress = analysisProgress.get("context-reanalysis", id);
  if (progress) {
    if (progress.status === "done") return res.json({ active: false, done: true, ...progress.outcome });
    return res.json({ active: true, stage: progress.stage, model: progress.model });
  }

  const analysis = await Analysis.findBySubmissionId(id);
  if (!analysis) {
    return res.json({ active: false });
  }
  return res.json({ active: false, done: true, analysis });
}

// Powers the "Project Context" panel (current sourced facts) and "Context
// History" timeline (every interpretation attempt, applied or not).
async function getSubmissionContext(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }
  const submission = await Submission.findById(id);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const [currentContext, activeFacts, changeHistory] = await Promise.all([
    buildCurrentContext(submission),
    SubmissionContextFact.findActiveBySubmissionId(id),
    SubmissionContextChange.findAllBySubmissionId(id),
  ]);

  res.json({ currentContext, activeFacts, changeHistory, contextVersion: submission.contextVersion });
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

// Lets an admin start/stop Ollama remotely from the dashboard — talks to a
// small always-on control helper running on whichever machine hosts Ollama
// (see ai/README.md's "Remote Ollama control" section for the full setup),
// over the same Tailscale connection used for AI analysis itself. Optional:
// responds 503 until both OLLAMA_CONTROL_URL and OLLAMA_CONTROL_SECRET are
// set. 502 covers everything else that can go wrong reaching it (the
// machine is off, asleep, not connected to the tailnet, etc.) — there's no
// way to tell those apart from here, and the admin dashboard doesn't need
// to; "can't reach it" is the actionable message either way.
function makeOllamaControlHandler(path, method) {
  return async function handler(req, res) {
    if (!env.ollamaControlUrl || !env.ollamaControlSecret) {
      return res.status(503).json({ error: "Ollama remote control is not configured on this server." });
    }

    let result;
    try {
      const controlRes = await fetch(`${env.ollamaControlUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${env.ollamaControlSecret}` },
        dispatcher: tailscaleDispatcher,
        signal: AbortSignal.timeout(10000),
      });
      if (!controlRes.ok) throw new Error(`control helper returned HTTP ${controlRes.status}`);
      result = await controlRes.json();
    } catch (err) {
      return res.status(502).json({ error: "Could not reach the Ollama control helper. Is the machine on and connected?" });
    }

    res.json(result);
  };
}

const getOllamaStatus = makeOllamaControlHandler("/status", "GET");
const startOllamaRemote = makeOllamaControlHandler("/start", "POST");
const stopOllamaRemote = makeOllamaControlHandler("/stop", "POST");

module.exports = {
  listSubmissions,
  updateSubmissionStatus,
  analyzeSubmission,
  upsertOutcome,
  exportSubmissions,
  draftEmail,
  getAssetSignedUrl,
  deleteSubmission,
  removeAsset,
  cleanupAssets,
  getOllamaStatus,
  startOllamaRemote,
  stopOllamaRemote,
  getAnalysisProgress,
  getEmailDraftProgress,
  interpretSubmissionContext,
  getContextInterpretProgress,
  applyContextChanges,
  getContextReanalysisProgress,
  getSubmissionContext,
};
