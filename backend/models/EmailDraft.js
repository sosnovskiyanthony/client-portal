const { pool } = require("../config/database");

const VALID_STATUSES = ["pending", "processing", "completed", "failed"];

// One row per submission — UPSERT means "draft" and "regenerate" are the
// same operation, mirroring models/Analysis.js.
async function createPending(submissionId) {
  const { rows } = await pool.query(
    `INSERT INTO email_drafts (submission_id, status)
     VALUES ($1, 'pending')
     ON CONFLICT (submission_id)
     DO UPDATE SET status = 'pending', updated_at = now()
     RETURNING *`,
    [submissionId]
  );
  return serialize(rows[0]);
}

async function markProcessing(submissionId, { provider, model, promptVersion }) {
  const { rows } = await pool.query(
    `UPDATE email_drafts
     SET status = 'processing', provider = $2, model = $3, prompt_version = $4, error = NULL, updated_at = now()
     WHERE submission_id = $1
     RETURNING *`,
    [submissionId, provider, model, promptVersion]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function markCompleted(submissionId, { subject, body, provider, model, promptVersion }) {
  const { rows } = await pool.query(
    `UPDATE email_drafts
     SET status = 'completed', subject = $2, body = $3, provider = $4, model = $5, prompt_version = $6, error = NULL, updated_at = now()
     WHERE submission_id = $1
     RETURNING *`,
    [submissionId, subject, body, provider, model, promptVersion]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

// error is a short, human-readable classification — see the identical note
// on models/Analysis.js's markFailed.
async function markFailed(submissionId, { error, provider, model, promptVersion }) {
  const { rows } = await pool.query(
    `UPDATE email_drafts
     SET status = 'failed', error = $2, provider = $3, model = $4, prompt_version = $5, updated_at = now()
     WHERE submission_id = $1
     RETURNING *`,
    [submissionId, error, provider || null, model || null, promptVersion || null]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

async function findBySubmissionId(submissionId) {
  const { rows } = await pool.query("SELECT * FROM email_drafts WHERE submission_id = $1", [submissionId]);
  return rows[0] ? serialize(rows[0]) : null;
}

async function findAllBySubmissionIds(submissionIds) {
  if (submissionIds.length === 0) return {};
  const { rows } = await pool.query(
    "SELECT * FROM email_drafts WHERE submission_id = ANY($1::int[])",
    [submissionIds]
  );
  const bySubmissionId = {};
  for (const row of rows) {
    bySubmissionId[row.submission_id] = serialize(row);
  }
  return bySubmissionId;
}

function serialize(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    subject: row.subject,
    body: row.body,
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
  findBySubmissionId,
  findAllBySubmissionIds,
};
