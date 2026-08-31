const { pool } = require("../config/database");

const VALID_OUTCOMES = ["in_progress", "completed", "abandoned", "lost"];

// One row per submission, any type — upsert makes "record" and "edit" the
// same operation, same pattern as models/Analysis.js.
async function upsert(submissionId, { outcome, finalScope, actualTimeline, quotedPrice, finalPrice, featuresDelivered, notes }) {
  if (outcome !== undefined && outcome !== null && !VALID_OUTCOMES.includes(outcome)) {
    throw new Error(`Invalid outcome: ${outcome}`);
  }

  const { rows } = await pool.query(
    `INSERT INTO project_outcomes
       (submission_id, outcome, final_scope, actual_timeline, quoted_price, final_price, features_delivered, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (submission_id) DO UPDATE SET
       outcome = EXCLUDED.outcome,
       final_scope = EXCLUDED.final_scope,
       actual_timeline = EXCLUDED.actual_timeline,
       quoted_price = EXCLUDED.quoted_price,
       final_price = EXCLUDED.final_price,
       features_delivered = EXCLUDED.features_delivered,
       notes = EXCLUDED.notes,
       updated_at = now()
     RETURNING *`,
    [
      submissionId,
      outcome || null,
      finalScope || null,
      actualTimeline || null,
      quotedPrice === undefined || quotedPrice === "" ? null : quotedPrice,
      finalPrice === undefined || finalPrice === "" ? null : finalPrice,
      Array.isArray(featuresDelivered) ? JSON.stringify(featuresDelivered) : null,
      notes || null,
    ]
  );
  return serialize(rows[0]);
}

async function findBySubmissionId(submissionId) {
  const { rows } = await pool.query("SELECT * FROM project_outcomes WHERE submission_id = $1", [submissionId]);
  return rows[0] ? serialize(rows[0]) : null;
}

async function findAllBySubmissionIds(submissionIds) {
  if (submissionIds.length === 0) return {};
  const { rows } = await pool.query(
    "SELECT * FROM project_outcomes WHERE submission_id = ANY($1::int[])",
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
    outcome: row.outcome,
    finalScope: row.final_scope,
    actualTimeline: row.actual_timeline,
    quotedPrice: row.quoted_price === null ? null : Number(row.quoted_price),
    finalPrice: row.final_price === null ? null : Number(row.final_price),
    featuresDelivered: row.features_delivered || [],
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { upsert, findBySubmissionId, findAllBySubmissionIds, VALID_OUTCOMES };
