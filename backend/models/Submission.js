const { pool } = require("../config/database");

// A real sales pipeline, not just "seen it or not" — lets the admin
// dashboard track a lead all the way through to whether it actually became
// paying work.
const VALID_STATUSES = [
  "new",
  "reviewed",
  "contacted",
  "qualified",
  "discovery",
  "proposal_sent",
  "won",
  "lost",
];

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

// Admin dashboard page size — kept here (not env-configurable) since it's a
// UI decision, not deployment config.
const PAGE_SIZE = 20;

// type: "all" (or omitted) for no filter, otherwise an exact submission type.
// page: 1-indexed.
async function findPage({ type, page = 1 } = {}) {
  const params = [];
  let whereClause = "";
  if (type && type !== "all") {
    params.push(type);
    whereClause = `WHERE type = $${params.length}`;
  }

  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  params.push(PAGE_SIZE, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const { rows } = await pool.query(
    `SELECT * FROM submissions ${whereClause} ORDER BY created_at DESC, id DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  return rows.map(serialize);
}

// Unpaginated — used only by the CSV export, which needs every matching row
// at once. findPage() above stays paginated for the dashboard's own list.
async function findAll({ type } = {}) {
  const params = [];
  let whereClause = "";
  if (type && type !== "all") {
    params.push(type);
    whereClause = `WHERE type = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT * FROM submissions ${whereClause} ORDER BY created_at DESC, id DESC`,
    params
  );
  return rows.map(serialize);
}

async function count({ type } = {}) {
  const params = [];
  let whereClause = "";
  if (type && type !== "all") {
    params.push(type);
    whereClause = `WHERE type = $1`;
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM submissions ${whereClause}`, params);
  return rows[0].count;
}

async function updateStatus(id, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  const { rows } = await pool.query(
    "UPDATE submissions SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
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
    updatedAt: row.updated_at,
  };
}

module.exports = { create, findById, findPage, findAll, count, updateStatus, VALID_STATUSES, PAGE_SIZE };
