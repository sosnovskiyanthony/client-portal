// Full-stack integration tests for admin submission search (see
// models/Submission.js's buildWhereClause `search` handling,
// controllers/adminController.js's listSubmissions/exportSubmissions).
// Same spawn-the-real-server pattern as the other integration test files.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");

const TEST_PORT = 8806;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_EMAIL_MARKER = "@submission-search-test.example";

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

  // Two distinctly-named/worded submissions, created directly via the
  // model (not through the rate-limited public intake endpoints — this
  // file needs several searches, and submissionLimiter's 10/hr budget is
  // shared across every intake test file in the suite; see
  // test/servicesIntake.test.js's own comment on the same constraint).
  const Submission = require("../models/Submission");
  await Submission.create({
    type: "contact",
    clientName: "Widgetworks Marzipan Co",
    email: `marzipan${TEST_EMAIL_MARKER}`,
    projectDetails: { name: "Widgetworks Marzipan Co", email: `marzipan${TEST_EMAIL_MARKER}`, message: "We need a rebrand with a bespoke fondant-themed homepage." },
  });
  await Submission.create({
    type: "web-design",
    clientName: "Quolldigger Roofing",
    email: `quolldigger${TEST_EMAIL_MARKER}`,
    projectDetails: { goal: "lead-gen", summary: "A roofing company site.", brandStatus: "established", features: ["cms"], contentReadiness: "ready", timeline: "2-4-weeks" },
  });
});

test.after(async () => {
  await pool.query(`DELETE FROM submissions WHERE email LIKE $1`, [`%${TEST_EMAIL_MARKER}`]);
  await pool.end();
  serverProcess.kill();
});

test("search requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/submissions?search=Marzipan`);
  assert.equal(res.status, 401);
});

test("search matches client_name", async () => {
  const res = await authed("/api/admin/submissions?search=Marzipan");
  const body = await res.json();
  assert.equal(body.submissions.length, 1);
  assert.equal(body.submissions[0].clientName, "Widgetworks Marzipan Co");
});

test("search matches email", async () => {
  const res = await authed(`/api/admin/submissions?search=quolldigger${TEST_EMAIL_MARKER}`);
  const body = await res.json();
  assert.equal(body.submissions.length, 1);
  assert.equal(body.submissions[0].clientName, "Quolldigger Roofing");
});

test("search matches inside project details (JSONB text)", async () => {
  const res = await authed("/api/admin/submissions?search=fondant-themed");
  const body = await res.json();
  assert.equal(body.submissions.length, 1);
  assert.equal(body.submissions[0].clientName, "Widgetworks Marzipan Co");
});

test("search is case-insensitive", async () => {
  const res = await authed("/api/admin/submissions?search=MARZIPAN");
  const body = await res.json();
  assert.equal(body.submissions.length, 1);
});

test("search combines with the type filter — narrows further, doesn't OR with it", async () => {
  const wrongType = await authed("/api/admin/submissions?search=Marzipan&type=web-design");
  assert.equal((await wrongType.json()).submissions.length, 0, "Marzipan is a contact submission, not web-design");

  const rightType = await authed("/api/admin/submissions?search=Quolldigger&type=web-design");
  assert.equal((await rightType.json()).submissions.length, 1);
});

test("a non-matching search returns zero results, not an error", async () => {
  const res = await authed("/api/admin/submissions?search=thisstringmatchesnothingatall98765");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).submissions.length, 0);
});

test("an empty/whitespace-only search behaves like no search at all", async () => {
  const withSpaces = await authed("/api/admin/submissions?search=%20%20%20");
  const withoutSearch = await authed("/api/admin/submissions?type=all");
  const a = await withSpaces.json();
  const b = await withoutSearch.json();
  assert.equal(a.total, b.total);
});

test("CSV export honors the search term", async () => {
  const res = await authed("/api/admin/submissions/export?search=Marzipan");
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.ok(csv.includes("Widgetworks Marzipan Co"));
  assert.ok(!csv.includes("Quolldigger Roofing"));
});

test("an overly long search string is truncated server-side, not rejected or left unbounded", async () => {
  const longSearch = "a".repeat(5000);
  const res = await authed(`/api/admin/submissions?search=${longSearch}`);
  assert.equal(res.status, 200, "a very long search string must not 500 or hang");
});
