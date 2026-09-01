const { pool } = require("../config/database");

async function findAll() {
  const { rows } = await pool.query("SELECT * FROM contract_templates ORDER BY id");
  return rows.map(serialize);
}

async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM contract_templates WHERE id = $1", [id]);
  return rows[0] ? serialize(rows[0]) : null;
}

async function findActive() {
  const { rows } = await pool.query("SELECT * FROM contract_templates WHERE is_active = true LIMIT 1");
  return rows[0] ? serialize(rows[0]) : null;
}

async function create({ name, sections }) {
  const { rows } = await pool.query(
    "INSERT INTO contract_templates (name, is_active, sections) VALUES ($1, false, $2) RETURNING *",
    [name, JSON.stringify(sections)]
  );
  return serialize(rows[0]);
}

async function update(id, { name, sections }) {
  const setClauses = [];
  const params = [id];
  if (name !== undefined) {
    params.push(name);
    setClauses.push(`name = $${params.length}`);
  }
  if (sections !== undefined) {
    params.push(JSON.stringify(sections));
    setClauses.push(`sections = $${params.length}`);
  }
  if (setClauses.length === 0) return findById(id);

  const { rows } = await pool.query(
    `UPDATE contract_templates SET ${setClauses.join(", ")}, updated_at = now() WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ? serialize(rows[0]) : null;
}

// Exactly one active template at a time — deactivate every other row in
// the same statement set as activating this one, inside a single
// transaction so a concurrent read never sees zero or two active rows.
async function activate(id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE contract_templates SET is_active = false, updated_at = now() WHERE is_active = true");
    const { rows } = await client.query(
      "UPDATE contract_templates SET is_active = true, updated_at = now() WHERE id = $1 RETURNING *",
      [id]
    );
    await client.query("COMMIT");
    return rows[0] ? serialize(rows[0]) : null;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function serialize(row) {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active,
    sections: row.sections,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = { findAll, findById, findActive, create, update, activate };
