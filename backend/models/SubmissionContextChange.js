const { pool } = require("../config/database");

const VALID_STATUSES = ["pending_review", "applied", "rejected"];

// The Context History audit trail — one row per "Add Context" interpretation
// attempt, from the raw admin input through to what actually happened to
// it. Created by services/runContextInterpretation.js (status:
// pending_review), then finalized by services/applyContextChanges.js
// (status: applied, with approved_changes + resulting_context_version) or
// by an explicit rejection (status: rejected).

async function createPendingReview(submissionId, { rawInstruction, interpretation, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO submission_context_changes (submission_id, raw_instruction, interpretation, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [submissionId, rawInstruction, JSON.stringify(interpretation), createdBy || null]
  );
  return serialize(rows[0]);
}

async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM submission_context_changes WHERE id = $1", [id]);
  return rows[0] ? serialize(rows[0]) : null;
}

async function findAllBySubmissionId(submissionId) {
  const { rows } = await pool.query(
    "SELECT * FROM submission_context_changes WHERE submission_id = $1 ORDER BY created_at DESC",
    [submissionId]
  );
  return rows.map(serialize);
}

async function markRejected(id) {
  const { rows } = await pool.query(
    `UPDATE submission_context_changes SET status = 'rejected' WHERE id = $1 AND status = 'pending_review' RETURNING *`,
    [id]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

function serialize(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    rawInstruction: row.raw_instruction,
    interpretation: row.interpretation,
    approvedChanges: row.approved_changes,
    status: row.status,
    resultingContextVersion: row.resulting_context_version,
    createdBy: row.created_by,
    appliedBy: row.applied_by,
    createdAt: row.created_at,
    appliedAt: row.applied_at,
  };
}

module.exports = { VALID_STATUSES, createPendingReview, findById, findAllBySubmissionId, markRejected, serialize };
