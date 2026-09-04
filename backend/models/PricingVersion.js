const { pool } = require("../config/database");

const VALID_STATUSES = ["pending", "processing", "completed", "failed"];

// Append-only pricing history — every generation is its own row (see
// config/database.js's submission_pricing_versions comment for why this
// differs from submission_analyses' single-overwritten-row pattern).
// version_number follows models/ContractVersion.js's exact
// MAX(existing)+1 convention.
async function createPending(submissionId, contextVersion) {
  const { rows: maxRows } = await pool.query(
    "SELECT COALESCE(MAX(version_number), 0) AS max_version FROM submission_pricing_versions WHERE submission_id = $1",
    [submissionId]
  );
  const versionNumber = maxRows[0].max_version + 1;

  const { rows } = await pool.query(
    `INSERT INTO submission_pricing_versions (submission_id, version_number, context_version, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING *`,
    [submissionId, versionNumber, contextVersion]
  );
  return serialize(rows[0]);
}

async function markProcessing(id, { provider, model, promptVersion }) {
  const { rows } = await pool.query(
    `UPDATE submission_pricing_versions
     SET status = 'processing', provider = $2, model = $3, prompt_version = $4, error = NULL, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, provider, model, promptVersion]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function markCompleted(id, { result, provider, model, promptVersion }) {
  const { rows } = await pool.query(
    `UPDATE submission_pricing_versions
     SET status = 'completed', result = $2, provider = $3, model = $4, prompt_version = $5, error = NULL, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, JSON.stringify(result), provider, model, promptVersion]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function markFailed(id, { error, provider, model, promptVersion }) {
  const { rows } = await pool.query(
    `UPDATE submission_pricing_versions
     SET status = 'failed', error = $2, provider = $3, model = $4, prompt_version = $5, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, error, provider || null, model || null, promptVersion || null]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM submission_pricing_versions WHERE id = $1", [id]);
  return rows[0] ? serialize(rows[0]) : null;
}

// The current (highest-version) row for a submission, regardless of
// status — the caller decides what to do with a pending/processing/failed
// current version (same shape adminController already handles for
// submission_analyses).
async function findCurrentBySubmissionId(submissionId) {
  const { rows } = await pool.query(
    "SELECT * FROM submission_pricing_versions WHERE submission_id = $1 ORDER BY version_number DESC LIMIT 1",
    [submissionId]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function findAllBySubmissionId(submissionId) {
  const { rows } = await pool.query(
    "SELECT * FROM submission_pricing_versions WHERE submission_id = $1 ORDER BY version_number DESC",
    [submissionId]
  );
  return rows.map(serialize);
}

function serialize(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    versionNumber: row.version_number,
    contextVersion: row.context_version,
    status: row.status,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    result: row.result,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  VALID_STATUSES,
  createPending,
  markProcessing,
  markCompleted,
  markFailed,
  findById,
  findCurrentBySubmissionId,
  findAllBySubmissionId,
};
