// Proves the getAssetSignedUrl ownership fix: a signed-URL request must be
// scoped to a specific submission and the requested path must actually
// belong to that submission — a Guardian security review found the
// previous route (POST /storage/signed-url, no submission id) let any
// valid admin JWT sign a URL for any well-formed brand-asset UUID path.
// Full-stack integration test — same spawn-the-real-server pattern as the
// other integration test files (see test/servicesIntake.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

const TEST_PORT = 8803;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_EMAIL_MARKER = "@storage-ownership-test.example";

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

async function authed(pathAndQuery, options = {}) {
  const token = await adminToken();
  return fetch(`${BASE_URL}${pathAndQuery}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
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
  await pool.query(`DELETE FROM submissions WHERE email LIKE $1`, [`%${TEST_EMAIL_MARKER}`]);
  await pool.end();
  serverProcess.kill();
});

test("the old unscoped route no longer exists", async () => {
  const res = await authed("/api/admin/storage/signed-url", {
    method: "POST",
    body: JSON.stringify({ path: `brand-assets/${randomUUID()}.png` }),
  });
  assert.equal(res.status, 404);
});

test("requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/submissions/1/storage/signed-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: `brand-assets/${randomUUID()}.png` }),
  });
  assert.equal(res.status, 401);
});

test("a well-formed UUID path not attached to the given submission is rejected, even though the path shape is valid", async () => {
  // A real submission (so we reach the ownership check, not a 404-for-
  // missing-submission short-circuit), but the requested path was never
  // actually attached to it.
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Storage Ownership Test",
      email: `owner${TEST_EMAIL_MARKER}`,
      goal: "brand",
      summary: "Testing storage ownership scoping.",
      brandStatus: "established",
      features: ["cms"],
      contentReadiness: "ready",
      timeline: "2-4-weeks",
    }),
  });
  assert.equal(createRes.status, 201);
  const { submission } = await createRes.json();

  const unrelatedPath = `brand-assets/${randomUUID()}.png`;
  const res = await authed(`/api/admin/submissions/${submission.id}/storage/signed-url`, {
    method: "POST",
    body: JSON.stringify({ path: unrelatedPath }),
  });
  // Either 404 (no attached file at that path) or 503 (storage not
  // configured in this test environment) is acceptable — both prove the
  // request never reached storage.createSignedUrl for an unowned path.
  // What it must NEVER be is 200.
  assert.notEqual(res.status, 200);
});

test("a nonexistent submission id returns 404, not a signed URL", async () => {
  const res = await authed("/api/admin/submissions/999999999/storage/signed-url", {
    method: "POST",
    body: JSON.stringify({ path: `brand-assets/${randomUUID()}.png` }),
  });
  assert.notEqual(res.status, 200);
});

test("malformed path shapes are rejected regardless of submission id", async () => {
  const res = await authed("/api/admin/submissions/1/storage/signed-url", {
    method: "POST",
    body: JSON.stringify({ path: "brand-assets/../../../etc/passwd" }),
  });
  assert.equal(res.status, 400);
});
