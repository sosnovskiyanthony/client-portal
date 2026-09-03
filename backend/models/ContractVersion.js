const { pool } = require("../config/database");

// "ai_assisted_edit" — a version created by applying AI-proposed changes
// (see controllers/contractController.js's applyContractEditChanges) that
// an admin explicitly approved, distinct from "ai_generated" (the
// original full AI draft) and "admin_edited" (a fully manual edit with no
// AI involvement) — the contract audit log needs to distinguish these.
const VALID_SOURCES = ["ai_generated", "admin_edited", "ai_assisted_edit", "final"];

// version_number is computed as MAX(existing)+1 for this contract rather
// than a shared sequence — deliberately not wrapped in a serializable
// transaction, since in practice exactly one admin edits one contract at a
// time (single-admin app; see contract_number_counters/contractNumbering.js
// for the one case in this feature that genuinely needs atomic-under-
// concurrency numbering, which this isn't).
async function create({ contractId, source, content, changeNote, createdBy }) {
  const { rows: maxRows } = await pool.query(
    "SELECT COALESCE(MAX(version_number), 0) AS max_version FROM contract_versions WHERE contract_id = $1",
    [contractId]
  );
  const versionNumber = maxRows[0].max_version + 1;

  const { rows } = await pool.query(
    `INSERT INTO contract_versions (contract_id, version_number, source, content, change_note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [contractId, versionNumber, source, JSON.stringify(content), changeNote || null, createdBy]
  );
  return serialize(rows[0]);
}

async function findAllByContractId(contractId) {
  const { rows } = await pool.query(
    "SELECT * FROM contract_versions WHERE contract_id = $1 ORDER BY version_number DESC",
    [contractId]
  );
  return rows.map(serialize);
}

function serialize(row) {
  return {
    id: row.id,
    contractId: row.contract_id,
    versionNumber: row.version_number,
    source: row.source,
    content: row.content,
    changeNote: row.change_note,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

module.exports = { VALID_SOURCES, create, findAllByContractId };
