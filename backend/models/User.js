const { pool } = require("../config/database");

async function findByEmail(email) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE email = $1",
    [String(email).toLowerCase()]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] || null;
}

// Invalidates every JWT issued before this call (see middleware/auth.js) —
// there's one admin account, so there's no per-session token to target
// individually; this is "log out everywhere" by construction, which is
// exactly what a single-admin "log out" should mean.
async function bumpTokenVersion(id) {
  const { rows } = await pool.query(
    "UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version",
    [id]
  );
  return rows[0] ? rows[0].token_version : null;
}

module.exports = { findByEmail, findById, bumpTokenVersion };
