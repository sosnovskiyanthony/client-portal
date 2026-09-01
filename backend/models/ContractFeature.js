const { pool } = require("../config/database");

// Active-only by default — the catalog an admin picks from when building a
// contract shouldn't show retired features. findAll(true) (includeInactive)
// exists for the admin's own catalog-management view, where seeing
// deactivated rows (to reactivate them) is the point.
async function findAll({ includeInactive = false } = {}) {
  const where = includeInactive ? "" : "WHERE active = true";
  const { rows } = await pool.query(
    `SELECT * FROM contract_features ${where} ORDER BY category, sort_order, id`
  );
  return rows.map(serialize);
}

async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM contract_features WHERE id = $1", [id]);
  return rows[0] ? serialize(rows[0]) : null;
}

async function create({ category, name, description, defaultWording, defaultPrice, sortOrder }) {
  const { rows } = await pool.query(
    `INSERT INTO contract_features (category, name, description, default_wording, default_price, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [category, name, description || null, defaultWording || null, defaultPrice ?? null, sortOrder ?? 0]
  );
  return serialize(rows[0]);
}

async function update(id, fields) {
  const columns = {
    category: "category",
    name: "name",
    description: "description",
    defaultWording: "default_wording",
    defaultPrice: "default_price",
    active: "active",
    sortOrder: "sort_order",
  };
  const setClauses = [];
  const params = [id];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in fields)) continue;
    params.push(fields[key]);
    setClauses.push(`${column} = $${params.length}`);
  }
  if (setClauses.length === 0) return findById(id);

  const { rows } = await pool.query(
    `UPDATE contract_features SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ? serialize(rows[0]) : null;
}

// Deactivate, never a hard DELETE — a retired feature must not vanish from
// any contract_selected_features row that referenced it historically (that
// table snapshots name/description/wording independently anyway, but the
// feature_id FK itself should keep resolving for as long as it can).
async function deactivate(id) {
  return update(id, { active: false });
}

function serialize(row) {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description,
    defaultWording: row.default_wording,
    defaultPrice: row.default_price === null ? null : Number(row.default_price),
    active: row.active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { findAll, findById, create, update, deactivate };
