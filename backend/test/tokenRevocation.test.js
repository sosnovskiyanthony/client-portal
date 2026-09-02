// Full-stack integration tests for real server-side logout / token
// revocation (see middleware/auth.js's token_version check,
// controllers/authController.js's logout, models/User.js's
// bumpTokenVersion). Same spawn-the-real-server pattern as the other
// integration test files.
//
// Consolidated to a small, fixed number of real /api/auth/login calls
// (4 total) to stay comfortably under loginLimiter's 5/15min budget —
// this file's whole point is exercising real fresh logins, unlike most
// other integration test files which log in once and cache the token.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const TEST_PORT = 8805;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let serverProcess;
let pool;

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server did not become ready in time");
}

async function login() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@brindleaf.dev", password: "brindleaf-admin" }),
  });
  if (!res.ok) throw new Error(`Test setup failed: admin login returned ${res.status}`);
  return res.json();
}

test.before(async () => {
  serverProcess = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: "test" },
    stdio: "ignore",
  });
  await waitForServer(BASE_URL);
  pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/client_portal_dev" });
});

test.after(async () => {
  await pool.query("DELETE FROM security_events WHERE event_type LIKE 'auth_%'");
  await pool.end();
  serverProcess.kill();
});

test("a fresh login token includes a tokenVersion claim and works against a protected route", async () => {
  const { token } = await login(); // login #1
  const decoded = jwt.decode(token);
  assert.equal(typeof decoded.tokenVersion, "number");

  const res = await fetch(`${BASE_URL}/api/admin/guardian/ai/state`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
});

test("POST /api/auth/logout requires a valid token", async () => {
  const res = await fetch(`${BASE_URL}/api/auth/logout`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("logout invalidates the token, logs a security event, a second logout with the now-dead token fails cleanly (not a server error)", async () => {
  const { token } = await login(); // login #2

  const before = await fetch(`${BASE_URL}/api/admin/guardian/ai/state`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(before.status, 200);

  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(logoutRes.status, 204);

  const after = await fetch(`${BASE_URL}/api/admin/guardian/ai/state`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(after.status, 401, "the exact same token must be rejected immediately after logout");

  const secondLogout = await fetch(`${BASE_URL}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  assert.equal(secondLogout.status, 401, "logging out again with an already-dead token must fail cleanly, not 500");

  const { rows } = await pool.query(
    `SELECT event_type, severity, actor_type FROM security_events WHERE event_type = 'auth_logout' ORDER BY created_at DESC LIMIT 1`
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, "INFO");
  assert.equal(rows[0].actor_type, "admin");
});

test("a subsequent fresh login after logout issues a genuinely new, working token", async () => {
  const { token: firstToken } = await login(); // login #3
  await fetch(`${BASE_URL}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${firstToken}` } });

  const { token: secondToken } = await login(); // login #4
  assert.notEqual(secondToken, firstToken);

  const res = await fetch(`${BASE_URL}/api/admin/guardian/ai/state`, { headers: { Authorization: `Bearer ${secondToken}` } });
  assert.equal(res.status, 200);
});

test("a token signed without a tokenVersion claim (pre-revocation-feature shape) is rejected, not grandfathered in", async () => {
  const env = require("../config/env");
  const oldStyleToken = jwt.sign({ sub: 1, email: "admin@brindleaf.dev", role: "admin" }, env.jwtSecret, { expiresIn: "12h" });

  const res = await fetch(`${BASE_URL}/api/admin/guardian/ai/state`, { headers: { Authorization: `Bearer ${oldStyleToken}` } });
  assert.equal(res.status, 401);
});

test("a forged token with a guessed/wrong tokenVersion is rejected", async () => {
  const env = require("../config/env");
  const forged = jwt.sign({ sub: 1, email: "admin@brindleaf.dev", role: "admin", tokenVersion: 999999 }, env.jwtSecret, { expiresIn: "12h" });

  const res = await fetch(`${BASE_URL}/api/admin/guardian/ai/state`, { headers: { Authorization: `Bearer ${forged}` } });
  assert.equal(res.status, 401);
});
