const { pool } = require("../config/database");

const VALID_STATUSES = ["draft", "needs_review", "ready_for_approval", "approved", "sent", "signed", "completed", "cancelled"];

const PAGE_SIZE = 20;

// Imports the fields the spec calls out as safe to pull straight from a
// submission (client identity + a couple of project-adjacent facts) — never
// the raw free-text project details wholesale. Everything imported here is
// still just a starting point the admin can edit before anything is
// AI-reviewed or generated; nothing here is itself an "approved" term yet.
async function createFromSubmission({ submission, contractNumber, templateId, createdBy }) {
  const details = submission.projectDetails || {};
  const { rows } = await pool.query(
    `INSERT INTO contracts (
       contract_number, submission_id, template_id,
       client_name, client_email, project_name, project_description,
       currency, created_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'USD', $8)
     RETURNING *`,
    [
      contractNumber,
      submission.id,
      templateId,
      submission.clientName || null,
      submission.email || null,
      details.website ? `Website project (${details.website})` : "Website project",
      details.summary || null,
      createdBy,
    ]
  );
  return serialize(rows[0]);
}

async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM contracts WHERE id = $1", [id]);
  return rows[0] ? serialize(rows[0]) : null;
}

async function findAllBySubmissionIds(submissionIds) {
  if (submissionIds.length === 0) return {};
  const { rows } = await pool.query(
    "SELECT * FROM contracts WHERE submission_id = ANY($1::int[]) ORDER BY created_at DESC",
    [submissionIds]
  );
  // Multiple contracts can exist per submission (a re-negotiated deal) —
  // group into arrays, newest first, rather than assuming one-per-submission
  // the way Analysis/EmailDraft's equivalent does.
  const bySubmissionId = {};
  for (const row of rows) {
    const serialized = serialize(row);
    if (!bySubmissionId[row.submission_id]) bySubmissionId[row.submission_id] = [];
    bySubmissionId[row.submission_id].push(serialized);
  }
  return bySubmissionId;
}

async function findPage({ status, search, page }) {
  const conditions = [];
  const params = [];

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    const idx = params.length;
    conditions.push(`(contract_number ILIKE $${idx} OR client_name ILIKE $${idx} OR client_email ILIKE $${idx} OR project_name ILIKE $${idx})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  params.push(PAGE_SIZE, offset);

  const { rows } = await pool.query(
    `SELECT * FROM contracts ${where} ORDER BY updated_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows.map(serialize);
}

async function count({ status, search }) {
  const conditions = [];
  const params = [];

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    const idx = params.length;
    conditions.push(`(contract_number ILIKE $${idx} OR client_name ILIKE $${idx} OR client_email ILIKE $${idx} OR project_name ILIKE $${idx})`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM contracts ${where}`, params);
  return rows[0].total;
}

// Generic patch for the builder's editable fields — every field is
// optional (only columns actually present in `fields` are updated), so the
// same function serves the client-info save, project-info save,
// pricing/payment save, timeline save, revisions save, responsibilities
// save, and custom-terms save without a dozen near-identical functions.
const PATCHABLE_COLUMNS = {
  clientName: "client_name",
  clientEmail: "client_email",
  clientCompany: "client_company",
  clientPhone: "client_phone",
  clientAddress: "client_address",
  projectName: "project_name",
  projectType: "project_type",
  projectDescription: "project_description",
  price: "price",
  currency: "currency",
  depositAmount: "deposit_amount",
  depositPercentage: "deposit_percentage",
  remainingBalance: "remaining_balance",
  paymentTerms: "payment_terms",
  startDate: "start_date",
  estimatedCompletionDate: "estimated_completion_date",
  includedRevisions: "included_revisions",
  additionalRevisionRate: "additional_revision_rate",
  additionalWorkRate: "additional_work_rate",
  clientResponsibilities: "client_responsibilities",
  customTerms: "custom_terms",
};

// pg encodes a plain JS Array parameter as a Postgres array literal
// ("{a,b}"), not JSON — fine for a real text[]/int[] column, but wrong for
// a JSONB one, which then fails to parse that literal as JSON (confirmed
// live: saving clientResponsibilities, a JS array, threw a real Postgres
// JSON-parse error until this was added). paymentTerms is a plain object,
// which pg does JSON.stringify automatically — but stringifying it
// explicitly here too keeps this list the single source of truth for
// "these columns are JSONB" rather than relying on that implicit,
// type-dependent default behavior.
const JSONB_COLUMNS = new Set(["paymentTerms", "clientResponsibilities"]);

async function update(id, fields) {
  const setClauses = [];
  const params = [id];

  for (const [key, column] of Object.entries(PATCHABLE_COLUMNS)) {
    if (!(key in fields)) continue;
    const value = fields[key];
    params.push(JSONB_COLUMNS.has(key) && value !== null ? JSON.stringify(value) : value);
    setClauses.push(`${column} = $${params.length}`);
  }
  if (setClauses.length === 0) return findById(id);

  const { rows } = await pool.query(
    `UPDATE contracts SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function updateStatus(id, status) {
  const { rows } = await pool.query(
    "UPDATE contracts SET status = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, status]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function setScopeSnapshot(id, scopeSnapshot) {
  const { rows } = await pool.query(
    "UPDATE contracts SET scope_snapshot = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, JSON.stringify(scopeSnapshot)]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function setGeneratedContent(id, content) {
  const { rows } = await pool.query(
    "UPDATE contracts SET generated_content = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, JSON.stringify(content)]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function setFinalContent(id, content) {
  const { rows } = await pool.query(
    "UPDATE contracts SET final_content = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, JSON.stringify(content)]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function markApproved(id) {
  const { rows } = await pool.query(
    "UPDATE contracts SET status = 'approved', approved_at = now(), updated_at = now() WHERE id = $1 RETURNING *",
    [id]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function markFinalized(id) {
  const { rows } = await pool.query(
    "UPDATE contracts SET finalized_at = now(), updated_at = now() WHERE id = $1 RETURNING *",
    [id]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function markSent(id) {
  const { rows } = await pool.query(
    "UPDATE contracts SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = $1 RETURNING *",
    [id]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function setPdfStoragePath(id, path) {
  const { rows } = await pool.query(
    "UPDATE contracts SET pdf_storage_path = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, path]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function deleteById(id) {
  await pool.query("DELETE FROM contracts WHERE id = $1", [id]);
}

function serialize(row) {
  return {
    id: row.id,
    contractNumber: row.contract_number,
    submissionId: row.submission_id,
    templateId: row.template_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    clientCompany: row.client_company,
    clientPhone: row.client_phone,
    clientAddress: row.client_address,
    projectName: row.project_name,
    projectType: row.project_type,
    projectDescription: row.project_description,
    status: row.status,
    price: row.price === null ? null : Number(row.price),
    currency: row.currency,
    depositAmount: row.deposit_amount === null ? null : Number(row.deposit_amount),
    depositPercentage: row.deposit_percentage === null ? null : Number(row.deposit_percentage),
    remainingBalance: row.remaining_balance === null ? null : Number(row.remaining_balance),
    paymentTerms: row.payment_terms,
    startDate: row.start_date,
    estimatedCompletionDate: row.estimated_completion_date,
    includedRevisions: row.included_revisions,
    additionalRevisionRate: row.additional_revision_rate === null ? null : Number(row.additional_revision_rate),
    additionalWorkRate: row.additional_work_rate === null ? null : Number(row.additional_work_rate),
    clientResponsibilities: row.client_responsibilities,
    customTerms: row.custom_terms,
    scopeSnapshot: row.scope_snapshot,
    generatedContent: row.generated_content,
    finalContent: row.final_content,
    pdfStoragePath: row.pdf_storage_path,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    finalizedAt: row.finalized_at,
    sentAt: row.sent_at,
    viewedAt: row.viewed_at,
    signedAt: row.signed_at,
  };
}

module.exports = {
  VALID_STATUSES,
  PAGE_SIZE,
  createFromSubmission,
  findById,
  findAllBySubmissionIds,
  findPage,
  count,
  update,
  updateStatus,
  setScopeSnapshot,
  setGeneratedContent,
  setFinalContent,
  markApproved,
  markFinalized,
  markSent,
  setPdfStoragePath,
  deleteById,
};
