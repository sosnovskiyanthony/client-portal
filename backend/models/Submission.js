const { pool } = require("../config/database");

const VALID_STATUSES = ["new", "reviewed", "contacted"];

async function create({ type, clientName, email, projectDetails, flexiblePaymentPreference }) {
  const { rows } = await pool.query(
    `INSERT INTO submissions (type, client_name, email, project_details, flexible_payment_preference, status)
     VALUES ($1, $2, $3, $4, $5, 'new')
     RETURNING *`,
    [
      type,
      clientName || null,
      email || null,
      projectDetails || null,
      flexiblePaymentPreference === undefined ? null : flexiblePaymentPreference,
    ]
  );
  return serialize(rows[0]);
}

async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM submissions WHERE id = $1", [id]);
  return rows[0] ? serialize(rows[0]) : null;
}

async function findAll() {
  const { rows } = await pool.query(
    "SELECT * FROM submissions ORDER BY created_at DESC, id DESC"
  );
  return rows.map(serialize);
}

async function updateStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  const { rows } = await pool.query(
    "UPDATE submissions SET status = $1 WHERE id = $2 RETURNING *",
    [status, id]
  );
  return rows[0] ? serialize(rows[0]) : null;
}

function serialize(row) {
  return {
    id: row.id,
    type: row.type,
    clientName: row.client_name,
    email: row.email,
    projectDetails: row.project_details,
    flexiblePaymentPreference: row.flexible_payment_preference,
    status: row.status,
    createdAt: row.created_at,
  };
}

module.exports = { create, findById, findAll, updateStatus, VALID_STATUSES };
