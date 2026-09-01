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

module.exports = {
  listContracts,
  getContract,
  createContractFromSubmission,
  updateContract,
  deleteContract,
  getContractAuditLog,
};
