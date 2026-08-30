const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const env = require("./env");

const dbPath = path.resolve(__dirname, "..", env.databaseFile);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    client_name TEXT,
    email TEXT,
    project_details TEXT,
    flexible_payment_preference INTEGER,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed the admin account on first run so the system is usable immediately.
const existingAdmin = db
  .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
  .get();

if (!existingAdmin) {
  const passwordHash = bcrypt.hashSync(env.adminPassword, 10);
  db.prepare(
    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'admin')"
  ).run(env.adminEmail, passwordHash);
  console.log(`Seeded admin user: ${env.adminEmail}`);
}

module.exports = db;
