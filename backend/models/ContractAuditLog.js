const { pool } = require("../config/database");

async function create({ contractId, action, actorUserId, details }) {
  const { rows } = await pool.query(
    `INSERT INTO contract_audit_log (contract_id, action, actor_user_id, details)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [contractId, action, actorUserId || null, details ? JSON.stringify(details) : null]
  );
  return serialize(rows[0]);
}

async function findAllByContractId(contractId) {
  const { rows } = await pool.query(
    "SELECT * FROM contract_audit_log WHERE contract_id = $1 ORDER BY created_at DESC",
    [contractId]
  );
  return rows.map(serialize);
}

function serialize(row) {
  return {
    id: row.id,
    contractId: row.contract_id,
    action: row.action,
    actorUserId: row.actor_user_id,
    details: row.details,
    createdAt: row.created_at,
  };
}

module.exports = { create, findAllByContractId };
