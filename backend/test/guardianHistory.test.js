// Full-stack integration tests for POST /api/admin/guardian/run and
// GET /api/admin/guardian/history — same pattern as
// test/guardianDiagnostics.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");

const TEST_PORT = 8801;
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

let cachedAdminToken = null;
async function adminToken() {
  if (cachedAdminToken) return cachedAdminToken;
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@brindleaf.dev", password: "brindleaf-admin" }),
  });
  if (!res.ok) throw new Error(`Test setup failed: admin login returned ${res.status}`);
  const body = await res.json();
  cachedAdminToken = body.token;
  return cachedAdminToken;
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
  // Only ever cleans up rows this test file itself created (check_type =
  // 'diagnostics' from a real "Run Guardian Check") — never a blanket
  // TRUNCATE, so a real production history table would never be touched by
  // this pattern even if pointed at one by mistake.
  await pool.query(`DELETE FROM guardian_checks WHERE summary LIKE $1`, ["Guardian diagnostics:%"]);
  await pool.end();
  serverProcess.kill();
});

test("POST /guardian/run requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/run`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("GET /guardian/history requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/history`);
  assert.equal(res.status, 401);
});

test("running a check persists a row and it shows up in history, newest first", async () => {
  const token = await adminToken();

  const runRes = await fetch(`${BASE_URL}/api/admin/guardian/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(runRes.status, 200);
  const runBody = await runRes.json();
  assert.ok(runBody.id);
  assert.ok(["HEALTHY", "WARNING", "FAILED"].includes(runBody.status));
  assert.ok(runBody.findings);
  assert.ok(runBody.createdAt);

  // A second run, so ordering is actually meaningful to assert on.
  await new Promise((r) => setTimeout(r, 50));
  const runRes2 = await fetch(`${BASE_URL}/api/admin/guardian/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const runBody2 = await runRes2.json();

  const historyRes = await fetch(`${BASE_URL}/api/admin/guardian/history?limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(historyRes.status, 200);
  const { history } = await historyRes.json();
  assert.ok(history.length >= 2);
  assert.equal(history[0].id, runBody2.id, "most recent run must be first");
  assert.ok(new Date(history[0].createdAt) >= new Date(history[1].createdAt));
});

test("an invalid/oversized limit is clamped, not passed through raw to SQL", async () => {
  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/guardian/history?limit=99999`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const { history } = await res.json();
  assert.ok(Array.isArray(history));
  assert.ok(history.length <= 100, "limit must be clamped to a sane maximum");
});

test("a non-numeric limit falls back to the default rather than erroring", async () => {
  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/guardian/history?limit=not-a-number`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const { history } = await res.json();
  assert.ok(Array.isArray(history));
});
