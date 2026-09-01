// Contracts feature — separate admin section from the main dashboard, but
// reusing the exact same authenticate+requireAdmin gate (see routes/
// contracts.js). CRUD only in this pass; AI review/generation, PDF, and
// email sending land in later controller additions (see the Contracts
// implementation plan).
const Contract = require("../models/Contract");
const ContractSelectedFeature = require("../models/ContractSelectedFeature");
const ContractVersion = require("../models/ContractVersion");
const ContractAuditLog = require("../models/ContractAuditLog");
const ContractTemplate = require("../models/ContractTemplate");
const Submission = require("../models/Submission");
const { getNextContractNumber } = require("../services/contractNumbering");
const { logAction } = require("../services/contractAudit");
const { runContractReview } = require("../services/runContractReview");
const { runContractGeneration } = require("../services/runContractGeneration");
const { generateContractPdf } = require("../services/contractPdf");
const { buildContractEmailDraft } = require("../services/contractEmail");
const { sendContractEmail } = require("../services/email");
const storage = require("../services/storage");
const { EMAIL_RE } = require("../lib/validators");
const { AiAnalysisError } = require("../ai/errors");
const analysisProgress = require("../lib/analysisProgress");
const env = require("../config/env");
const { randomUUID } = require("crypto");

async function listContracts(req, res) {
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  const search = typeof req.query.search === "string" ? req.query.search : "";
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const [contracts, total] = await Promise.all([
    Contract.findPage({ status, search, page }),
    Contract.count({ status, search }),
  ]);

  res.json({
    contracts,
    pagination: { page, pageSize: Contract.PAGE_SIZE, total, totalPages: Math.max(1, Math.ceil(total / Contract.PAGE_SIZE)) },
  });
}

async function getContract(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }

  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }

  const [selectedFeatures, versions] = await Promise.all([
    ContractSelectedFeature.findAllByContractId(id),
    ContractVersion.findAllByContractId(id),
  ]);

  res.json({ contract, selectedFeatures, versions });
}

// Imports the safe, structured subset of a submission (client identity +
// project-adjacent facts) into a fresh draft contract — never the raw
// free-text project details wholesale, and nothing imported here is
// itself an "agreed" term yet. The admin explicitly reviews/edits
// everything before it's ever sent to the AI review step, let alone
// generated or finalized.
async function createContractFromSubmission(req, res) {
  const submissionId = Number(req.params.submissionId);
  if (!Number.isInteger(submissionId)) {
    return res.status(400).json({ error: "Invalid submission id." });
  }

  const submission = await Submission.findById(submissionId);
  if (!submission) {
    return res.status(404).json({ error: "Submission not found." });
  }

  const activeTemplate = await ContractTemplate.findActive();
  if (!activeTemplate) {
    return res.status(500).json({ error: "No active contract template is configured." });
  }

  const contractNumber = await getNextContractNumber();
  const contract = await Contract.createFromSubmission({
    submission,
    contractNumber,
    templateId: activeTemplate.id,
    createdBy: req.user.sub,
  });

  await logAction(contract.id, "contract_created", req.user.sub, { submissionId });
  res.status(201).json({ contract });
}

// Only the whitelisted, patchable client/project/pricing/payment/timeline/
// revisions/responsibilities/custom-terms fields — see
// models/Contract.js's PATCHABLE_COLUMNS. Anything not in that list
// (status, generated_content, final_content, pdf path, etc.) has its own
// dedicated endpoint with its own workflow rules, deliberately not
// reachable through this general-purpose "save the builder form" route.
const NUMERIC_FIELDS = ["price", "depositAmount", "depositPercentage", "remainingBalance", "additionalRevisionRate", "additionalWorkRate"];
const INTEGER_FIELDS = ["includedRevisions"];

function validatePatchBody(body) {
  for (const field of NUMERIC_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value === null || value === "") continue; // explicit clear
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return `${field} must be a non-negative number.`;
    }
  }
  for (const field of INTEGER_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (value === null || value === "") continue;
    if (!Number.isInteger(value) || value < 0) {
      return `${field} must be a non-negative whole number.`;
    }
  }
  if ("depositPercentage" in body && body.depositPercentage !== null && body.depositPercentage > 100) {
    return "depositPercentage cannot exceed 100.";
  }
  if ("clientEmail" in body && body.clientEmail && !/^\S+@\S+\.\S+$/.test(body.clientEmail)) {
    return "clientEmail must be a valid email address.";
  }
  if ("currency" in body && body.currency && !/^[A-Z]{3}$/.test(body.currency)) {
    return "currency must be a 3-letter ISO code, e.g. USD.";
  }
  return null;
}

async function updateContract(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }

  const existing = await Contract.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Contract not found." });
  }

  const body = req.body || {};
  const validationError = validatePatchBody(body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const contract = await Contract.update(id, body);
  await logAction(id, "contract_updated", req.user.sub, { fields: Object.keys(body) });
  res.json({ contract });
}

// Only allowed pre-finalization — a finalized contract is the authoritative
// record of an agreement and must never simply disappear. Enforced here,
// server-side, not just hidden in the UI.
async function deleteContract(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }

  const existing = await Contract.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Contract not found." });
  }
  if (existing.finalizedAt) {
    return res.status(400).json({ error: "A finalized contract cannot be deleted." });
  }

  await Contract.deleteById(id);
  res.status(204).end();
}

async function getContractAuditLog(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }
  const auditLog = await ContractAuditLog.findAllByContractId(id);
  res.json({ auditLog });
}

function validateFeatureItem(f) {
  if (!f || typeof f !== "object") return "Each feature must be an object.";
  if (typeof f.category !== "string" || !f.category.trim()) return "Each feature needs a category.";
  if (typeof f.name !== "string" || !f.name.trim()) return "Each feature needs a name.";
  if ("price" in f && f.price !== null && (typeof f.price !== "number" || !Number.isFinite(f.price) || f.price < 0)) {
    return "A feature's price must be a non-negative number.";
  }
  return null;
}

// Replaces the entire "Scope of Work" checklist for this contract in one
// call — the builder saves the whole selection each time (check/uncheck
// any box, Save), not incrementally. Every item is explicitly represented
// here (name/category/wording/price snapshotted at save time) — this is
// what makes the eventual generated contract's scope section an explicit
// list rather than the vague "includes all requested features" wording
// the spec calls out as unacceptable.
async function setContractFeatures(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const existing = await Contract.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Contract not found." });
  }

  const features = (req.body || {}).features;
  if (!Array.isArray(features)) {
    return res.status(400).json({ error: "features must be an array." });
  }
  for (const f of features) {
    const validationError = validateFeatureItem(f);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
  }

  const selectedFeatures = await ContractSelectedFeature.replaceAll(id, features);
  await logAction(id, "contract_features_updated", req.user.sub, { count: selectedFeatures.length });
  res.json({ selectedFeatures });
}

async function addCustomFeature(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const existing = await Contract.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Contract not found." });
  }

  const body = req.body || {};
  const validationError = validateFeatureItem(body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const feature = await ContractSelectedFeature.addOne(id, { ...body, isCustom: true });
  await logAction(id, "contract_custom_feature_added", req.user.sub, { name: body.name });
  res.status(201).json({ feature });
}

async function removeContractFeature(req, res) {
  const id = Number(req.params.id);
  const rowId = Number(req.params.featureRowId);
  if (!Number.isInteger(id) || !Number.isInteger(rowId)) {
    return res.status(400).json({ error: "Invalid id." });
  }
  const existing = await Contract.findById(id);
  if (!existing) {
    return res.status(404).json({ error: "Contract not found." });
  }

  await ContractSelectedFeature.removeOne(id, rowId);
  await logAction(id, "contract_feature_removed", req.user.sub, { rowId });
  res.status(204).end();
}

// AI Task 1 — see services/runContractReview.js and ai/contractReviewPrompt.js.
// A real AI call (rate-limited, see routes/contracts.js), so failures are
// mapped to a specific status rather than a generic 500: 503 when Ollama
// itself isn't configured/reachable in a way the admin can't do anything
// about from here, 502 for every other classified AI-provider failure
// (timeout, invalid response, etc.) — never silently succeeds with a
// fabricated result.
async function reviewContract(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }

  // Unlike analyzeSubmission's STALE_PROCESSING_MS dedup (which checks a
  // persisted DB status column analysis has and review doesn't), this
  // reuses the same in-memory progress tracker already used for live
  // polling as the dedup guard — a double-click (or a raw API replay)
  // before the button disables client-side would otherwise fire two
  // concurrent AI calls against the same contract, with whichever finishes
  // last silently overwriting the other's review_result. Caught in review,
  // not by a live bug report.
  if (analysisProgress.get("contract-review", id)) {
    return res.status(409).json({ error: "A review is already in progress for this contract." });
  }

  const selectedFeatures = await ContractSelectedFeature.findAllByContractId(id);

  try {
    const updated = await runContractReview(contract, selectedFeatures);
    await logAction(id, "contract_reviewed", req.user.sub, { ready: updated.reviewResult && updated.reviewResult.ready });
    res.json({ contract: updated });
  } catch (err) {
    if (err instanceof AiAnalysisError) {
      return res.status(502).json({ error: err.message, code: err.code });
    }
    throw err;
  }
}

async function getContractReviewProgress(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const progress = analysisProgress.get("contract-review", id);
  if (!progress) return res.json({ active: false });
  res.json({ active: true, ...progress });
}

// AI Task 2 — see services/runContractGeneration.js and ai/contractPrompt.js.
// Same error-mapping reasoning as reviewContract above: a real AI call,
// classified failures become 502, never a silently-fabricated draft.
async function generateContract(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }

  // Same reasoning as reviewContract's dedup guard above.
  if (analysisProgress.get("contract-generate", id)) {
    return res.status(409).json({ error: "A draft is already being generated for this contract." });
  }

  const selectedFeatures = await ContractSelectedFeature.findAllByContractId(id);

  try {
    const updated = await runContractGeneration(contract, selectedFeatures, req.user.sub);
    await logAction(id, "contract_draft_generated", req.user.sub, {});
    res.json({ contract: updated });
  } catch (err) {
    if (err instanceof AiAnalysisError) {
      return res.status(502).json({ error: err.message, code: err.code });
    }
    throw err;
  }
}

async function getContractGenerationProgress(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const progress = analysisProgress.get("contract-generate", id);
  if (!progress) return res.json({ active: false });
  res.json({ active: true, ...progress });
}

// Saves an admin's edits to the contract content (whatever the current
// generated_content/final_content shape is — {sections:[{key,title,content}]})
// as a new 'admin_edited' version. Deliberately separate from
// updateContract's whitelisted-field PATCH above — this is structured
// contract prose, not a builder form field.
async function saveContractContent(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }

  const { sections } = req.body || {};
  if (!Array.isArray(sections) || sections.some((s) => !s || typeof s.key !== "string" || typeof s.title !== "string" || typeof s.content !== "string")) {
    return res.status(400).json({ error: "sections must be an array of { key, title, content }." });
  }

  const content = { sections };
  await Contract.setGeneratedContent(id, content);
  await ContractVersion.create({ contractId: id, source: "admin_edited", content, createdBy: req.user.sub });
  // Same reasoning as the fix in services/runContractGeneration.js: an
  // edit made after the contract was already approved means the approved
  // content and the current content have diverged — the approval no
  // longer describes what's actually here, so it must be re-confirmed
  // before this can be finalized. Only resets from 'approved' specifically
  // (an edit while still in 'draft'/'ready_for_approval'/'needs_review' is
  // the normal, expected pre-approval editing flow and needs no reset).
  const updated = contract.status === "approved" ? await Contract.updateStatus(id, "ready_for_approval") : await Contract.findById(id);
  await logAction(id, "contract_edited", req.user.sub, {});
  res.json({ contract: updated });
}

async function getContractVersions(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }
  const versions = await ContractVersion.findAllByContractId(id);
  res.json({ versions });
}

// Generates a fresh PDF from the contract's current content (final_content
// once approved, generated_content before that — whichever exists,
// preferring final_content since that's the authoritative one once it's
// set) and uploads it to the private contracts bucket. The storage path
// is a server-generated UUID, never derived from anything client-supplied
// — unlike the brand-assets signed-URL endpoint, there's no attacker-
// controlled path input here to validate against, since GET below only
// ever reads the path back from this contract's own DB row.
async function generateContractPdfHandler(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }
  if (!storage.isConfigured()) {
    return res.status(503).json({ error: "PDF storage is not configured on this server." });
  }

  const content = contract.finalContent || contract.generatedContent;
  if (!content) {
    return res.status(400).json({ error: "Generate a contract draft before creating a PDF." });
  }

  const buffer = await generateContractPdf(contract, content);
  const path = `contracts/${randomUUID()}.pdf`;

  try {
    await storage.uploadFile(path, buffer, "application/pdf", env.supabaseContractsBucket);
  } catch (err) {
    return res.status(502).json({ error: "Failed to upload the generated PDF." });
  }

  const updated = await Contract.setPdfStoragePath(id, path);
  await logAction(id, "contract_pdf_generated", req.user.sub, {});
  res.json({ contract: updated });
}

// Never returns a public/permanent URL — only a short-lived signed one,
// generated fresh on every call, same pattern as
// adminController.getAssetSignedUrl for brand assets.
const PDF_SIGNED_URL_TTL_SECONDS = 300;

async function getContractPdfUrl(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }
  if (!contract.pdfStoragePath) {
    return res.status(404).json({ error: "No PDF has been generated for this contract yet." });
  }
  if (!storage.isConfigured()) {
    return res.status(503).json({ error: "PDF storage is not configured on this server." });
  }

  try {
    const signedUrl = await storage.createSignedUrl(contract.pdfStoragePath, PDF_SIGNED_URL_TTL_SECONDS, env.supabaseContractsBucket);
    res.json({ signedUrl, expiresInSeconds: PDF_SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    res.status(502).json({ error: "Could not generate a link to the PDF." });
  }
}

// Explicit admin action — status never advances here on its own beyond
// the one automatic transition already made when a draft is generated
// (draft -> ready_for_approval, see services/runContractGeneration.js).
// Requires a draft to actually exist; approving an empty contract makes
// no sense.
async function approveContract(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }
  if (!contract.generatedContent) {
    return res.status(400).json({ error: "Generate a contract draft before approving it." });
  }

  const updated = await Contract.markApproved(id);
  await logAction(id, "contract_approved", req.user.sub, {});
  res.json({ contract: updated });
}

// Snapshots the CURRENT generated_content (whatever the admin has
// approved and possibly edited by this point) into final_content and
// records a new 'final' contract_versions row — never overwrites an
// existing final_content in place, since contract_versions is
// append-only and this always inserts a fresh row, so a prior finalized
// version is never lost even if the contract is finalized again later
// after further changes. Requires the contract to already be approved —
// finalizing something nobody has actually approved defeats the point of
// having an approval step at all.
async function finalizeContract(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }
  if (contract.status !== "approved") {
    return res.status(400).json({ error: "A contract must be approved before it can be finalized." });
  }
  if (!contract.generatedContent) {
    return res.status(400).json({ error: "No draft content to finalize." });
  }

  const finalContent = contract.generatedContent;
  // Sequential, not parallel — markFinalized's RETURNING * needs to see
  // final_content already written by the first query.
  await Contract.setFinalContent(id, finalContent);
  const finalized = await Contract.markFinalized(id);
  await ContractVersion.create({ contractId: id, source: "final", content: finalContent, createdBy: req.user.sub });
  await logAction(id, "contract_finalized", req.user.sub, {});
  res.json({ contract: finalized });
}

// Manual status transitions the automatic flow doesn't cover (sent is set
// by the email-send action in a later phase; signed/completed/cancelled
// are always the admin's own call, not something this app can infer).
async function setContractStatus(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const { status } = req.body || {};
  if (!Contract.VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${Contract.VALID_STATUSES.join(", ")}` });
  }

  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }

  const updated = await Contract.updateStatus(id, status);
  await logAction(id, "contract_status_changed", req.user.sub, { from: contract.status, to: status });
  res.json({ contract: updated });
}

// Computed fresh every call, never persisted — the admin reviews/edits the
// returned subject/body directly in the builder UI before sending (see
// frontend/js/contracts.js), so there's nothing server-side that needs to
// remember a draft between requests. Never touches contract content itself.
async function draftContractEmail(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }

  const { subject, body } = buildContractEmailDraft(contract);
  res.json({ subject, body, to: contract.clientEmail || "" });
}

// Sends whatever subject/body/to the admin has reviewed and approved in
// the UI — this endpoint does not regenerate them, so what was reviewed is
// exactly what's sent. Generates a fresh PDF for the attachment (preferring
// final_content once it exists, same precedence as generateContractPdfHandler)
// rather than requiring one to already exist in storage, since an admin
// sending a contract for the first time may not have generated+uploaded a
// PDF yet. On success, advances status to 'sent' and records sent_at.
async function sendContractEmailHandler(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid contract id." });
  }
  const contract = await Contract.findById(id);
  if (!contract) {
    return res.status(404).json({ error: "Contract not found." });
  }

  const { to, subject, body } = req.body || {};
  if (!to || !EMAIL_RE.test(to)) {
    return res.status(400).json({ error: "A valid recipient email is required." });
  }
  if (!subject || typeof subject !== "string" || !subject.trim()) {
    return res.status(400).json({ error: "A subject is required." });
  }
  if (!body || typeof body !== "string" || !body.trim()) {
    return res.status(400).json({ error: "A message body is required." });
  }

  const content = contract.finalContent || contract.generatedContent;
  if (!content) {
    return res.status(400).json({ error: "Generate a contract draft before sending it to the client." });
  }

  // Same escape set as services/contractEmail.js's own draft builder and
  // services/email.js's buildEmailHtml — order matters: escape first, then
  // inject the trusted <br> tags, so the tags we just added don't get
  // escaped themselves on a later pass.
  const html = `<div style="font-family:sans-serif;max-width:480px;white-space:pre-wrap;">${body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>")}</div>`;

  let pdfBuffer;
  try {
    pdfBuffer = await generateContractPdf(contract, content);
  } catch (err) {
    return res.status(500).json({ error: "Failed to generate the contract PDF for this email." });
  }

  try {
    await sendContractEmail({
      to,
      subject,
      html,
      pdfBuffer,
      pdfFilename: `${contract.contractNumber}.pdf`,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }

  const updated = await Contract.markSent(id);
  await logAction(id, "contract_emailed", req.user.sub, { to });
  res.json({ contract: updated });
}

module.exports = {
  listContracts,
  getContract,
  createContractFromSubmission,
  updateContract,
  deleteContract,
  getContractAuditLog,
  setContractFeatures,
  addCustomFeature,
  removeContractFeature,
  reviewContract,
  getContractReviewProgress,
  generateContract,
  getContractGenerationProgress,
  saveContractContent,
  getContractVersions,
  generateContractPdfHandler,
  getContractPdfUrl,
  approveContract,
  finalizeContract,
  setContractStatus,
  draftContractEmail,
  sendContractEmailHandler,
};
