const { pool } = require("../config/database");

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

async function create({ checkType, status, summary, commitSha, findings, durationMs }) {
  const { rows } = await pool.query(
    `INSERT INTO guardian_checks (check_type, status, summary, commit_sha, findings, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [checkType, status, summary || null, commitSha || null, findings || null, durationMs ?? null]
  );
  return serialize(rows[0]);
}

// `limit` is always clamped server-side, never passed through raw to SQL —
// an admin-controlled query param, but still never trusted as a bare
// integer straight into a LIMIT clause.
async function findRecent(limit = DEFAULT_LIMIT) {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const { rows } = await pool.query(
    `SELECT * FROM guardian_checks ORDER BY created_at DESC LIMIT $1`,
    [safeLimit]
  );
  return rows.map(serialize);
}

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    checkType: row.check_type,
    status: row.status,
    summary: row.summary,
    commitSha: row.commit_sha,
    findings: row.findings || null,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

module.exports = { create, findRecent };
