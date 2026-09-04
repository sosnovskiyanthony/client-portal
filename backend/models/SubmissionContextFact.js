const { pool } = require("../config/database");

// Every fact the admin has taught the AI project-intelligence system about
// a submission, via services/applyContextChanges.js — see that file for
// the actual ADD/MODIFY/REMOVE write logic (it runs inside one transaction
// alongside submission_context_changes and submissions.context_version, so
// writes live there rather than being duplicated here). This model is the
// read side: what's currently true about a submission's admin-added
// context, and its full history.

// The currently-active fact set — what feeds interpretSubmissionContext's
// "current context" and any future reanalysis/pricing step. Never includes
// superseded rows.
async function findActiveBySubmissionId(submissionId) {
  const { rows } = await pool.query(
    "SELECT * FROM submission_context_facts WHERE submission_id = $1 AND superseded_at IS NULL ORDER BY category, field",
    [submissionId]
  );
  return rows.map(serialize);
}

// Full history including superseded rows — powers a "what did this field
// used to be" view. Newest first within each field's own lineage.
async function findAllBySubmissionId(submissionId) {
  const { rows } = await pool.query(
    "SELECT * FROM submission_context_facts WHERE submission_id = $1 ORDER BY created_at DESC",
    [submissionId]
  );
  return rows.map(serialize);
}

function serialize(row) {
  return {
    id: row.id,
    submissionId: row.submission_id,
    category: row.category,
    field: row.field,
    value: row.value,
    source: row.source,
    sourceText: row.source_text,
    confidence: row.confidence,
    createdBy: row.created_by,
    createdAt: row.created_at,
    supersededAt: row.superseded_at,
    active: row.superseded_at === null,
  };
}

module.exports = { findActiveBySubmissionId, findAllBySubmissionId, serialize };
