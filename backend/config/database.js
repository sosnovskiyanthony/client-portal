const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const env = require("./env");

const isLocalHost = /localhost|127\.0\.0\.1/.test(env.databaseUrl);

const pool = new Pool({
  connectionString: env.databaseUrl,
  // Supabase (and most hosted Postgres) requires SSL; local dev Postgres
  // doesn't have it configured, so we skip it automatically for localhost.
  ssl: isLocalHost ? false : { rejectUnauthorized: false },
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      client_name TEXT,
      email TEXT,
      project_details JSONB,
      flexible_payment_preference BOOLEAN,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Seed the admin account on first run so the system is usable immediately.
  const { rows } = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (rows.length === 0) {
    const passwordHash = bcrypt.hashSync(env.adminPassword, 10);
    await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'admin')",
      [env.adminEmail, passwordHash]
    );
    console.log(`Seeded admin user: ${env.adminEmail}`);
  }
}

module.exports = { pool, init };
