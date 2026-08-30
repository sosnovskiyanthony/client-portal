const db = require("../config/database");

const VALID_STATUSES = ["new", "reviewed", "contacted"];

function create({ type, clientName, email, projectDetails, flexiblePaymentPreference }) {
  const result = db
    .prepare(
      `INSERT INTO submissions (type, client_name, email, project_details, flexible_payment_preference, status)
       VALUES (?, ?, ?, ?, ?, 'new')`
    )
    .run(
      type,
      clientName || null,
      email || null,
      projectDetails ? JSON.stringify(projectDetails) : null,
      flexiblePaymentPreference === undefined || flexiblePaymentPreference === null
        ? null
        : flexiblePaymentPreference
        ? 1
        : 0
    );

  return findById(Number(result.lastInsertRowid));
}

function findById(id) {
  const row = db.prepare("SELECT * FROM submissions WHERE id = ?").get(id);
  return row ? deserialize(row) : null;
}

function findAll() {
  const rows = db
    .prepare("SELECT * FROM submissions ORDER BY created_at DESC, id DESC")
    .all();
  return rows.map(deserialize);
}

function updateStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  db.prepare("UPDATE submissions SET status = ? WHERE id = ?").run(status, id);
  return findById(id);
}

function deserialize(row) {
  let projectDetails = null;
  if (row.project_details) {
    try {
      projectDetails = JSON.parse(row.project_details);
    } catch (err) {
      projectDetails = row.project_details;
    }
  }

  return {
    id: row.id,
    type: row.type,
    clientName: row.client_name,
    email: row.email,
    projectDetails,
    flexiblePaymentPreference:
      row.flexible_payment_preference === null ? null : Boolean(row.flexible_payment_preference),
    status: row.status,
    createdAt: row.created_at,
  };
}

module.exports = { create, findById, findAll, updateStatus, VALID_STATUSES };
