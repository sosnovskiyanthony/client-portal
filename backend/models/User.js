const { pool } = require("../config/database");

async function findByEmail(email) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [String(email).toLowerCase()]
  );
  return rows[0] || null;
}

module.exports = { findByEmail };
