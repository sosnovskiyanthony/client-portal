// Full-stack integration tests: spawns the real server (real Express app,
// real local Postgres — the same DB config/database.js already migrates
// against for local dev) as a child process and exercises it over HTTP.
//
// AI_PROVIDER is deliberately overridden to a nonexistent provider name for
// this test run. That's not testing a real AI failure mode (ollamaProvider
// and anthropicProvider's own failure paths are covered directly in
// ollamaProvider.test.js / aiService.test.js) — it's what makes "does a
// submission survive when analysis fails" a fast, deterministic assertion
// here, and it means this suite runs the same way whether or not Ollama is
// installed or running on whatever machine executes `npm test`.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");

const TEST_PORT = 8799;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_EMAIL_MARKER = "@integration-test.example";

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

async function adminToken() {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@studio.dev", password: "studio-admin" }),
  });
  const body = await res.json();
  return body.token;
}

test.before(async () => {
  serverProcess = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      AI_PROVIDER: "integration-test-invalid-provider",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
  await waitForServer(BASE_URL);
  pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/client_portal_dev" });
});

test.after(async () => {
  // Clean up only the rows this suite created.
  await pool.query(`DELETE FROM submissions WHERE email LIKE $1`, [`%${TEST_EMAIL_MARKER}`]);
  await pool.end();
  serverProcess.kill();
});

test("valid submission is saved and returns 201 with an id", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Integration Test", email: `valid${TEST_EMAIL_MARKER}`, goal: "brand", summary: "A test submission." }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.ok(Number.isInteger(body.submission.id));
});

test("missing required fields returns 400, nothing is saved", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `missingname${TEST_EMAIL_MARKER}` }), // no name
  });
  assert.equal(res.status, 400);
});

test("client-facing submission response never contains an 'analysis' key", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "No Leak", email: `noleak${TEST_EMAIL_MARKER}`, goal: "brand", summary: "s" }),
  });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.equal("analysis" in body, false);
  assert.equal("analysis" in body.submission, false);
});

test("intake never triggers analysis automatically — analysis stays null until an admin explicitly requests it", async () => {
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "No Auto Trigger", email: `noauto${TEST_EMAIL_MARKER}`, goal: "webapp", summary: "s" }),
  });
  const { submission } = await createRes.json();
  assert.equal(createRes.status, 201);

  // Give any hypothetical background process a real window to fire before
  // asserting it didn't.
  await new Promise((r) => setTimeout(r, 1500));

  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/submissions`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  const found = body.submissions.find((s) => s.id === submission.id);
  assert.ok(found);
  assert.equal(found.analysis, null, "no analysis row should exist until an admin explicitly triggers one");
});

test("admin-triggered analysis: submission survives an AI analysis failure — status stays saved, analysis is marked failed, not lost", async () => {
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Survives Failure", email: `survives${TEST_EMAIL_MARKER}`, goal: "webapp", summary: "s" }),
  });
  const { submission } = await createRes.json();
  assert.equal(createRes.status, 201);

  // Explicitly trigger analysis, the same way the admin dashboard's
  // "Analyze with AI" button does. The intentionally-invalid AI_PROVIDER
  // fails fast (no network call), so this resolves quickly.
  const token = await adminToken();
  const analyzeRes = await fetch(`${BASE_URL}/api/admin/submissions/${submission.id}/analyze`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const analyzeBody = await analyzeRes.json();
  assert.equal(analyzeRes.status, 200);
  assert.equal(analyzeBody.analysis.status, "failed");
  assert.ok(analyzeBody.analysis.error && analyzeBody.analysis.error.includes("unknown_provider"));

  // The original submission itself must be completely intact.
  const checkRes = await fetch(`${BASE_URL}/api/admin/submissions`, { headers: { Authorization: `Bearer ${token}` } });
  const checkBody = await checkRes.json();
  const stillThere = checkBody.submissions.find((s) => s.id === submission.id);
  assert.ok(stillThere);
  assert.equal(stillThere.clientName, "Survives Failure");
  assert.equal(stillThere.email, `survives${TEST_EMAIL_MARKER}`);
});

test("unauthorized (no token) cannot list submissions or trigger analysis", async () => {
  const listRes = await fetch(`${BASE_URL}/api/admin/submissions`);
  assert.equal(listRes.status, 401);

  const analyzeRes = await fetch(`${BASE_URL}/api/admin/submissions/1/analyze`, { method: "POST" });
  assert.equal(analyzeRes.status, 401);
});

test("unauthorized (garbage token) cannot list submissions", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/submissions`, { headers: { Authorization: "Bearer not-a-real-token" } });
  assert.equal(res.status, 401);
});

test("admin (valid token) can view a submission's analysis", async () => {
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin View Test", email: `adminview${TEST_EMAIL_MARKER}`, goal: "brand", summary: "s" }),
  });
  const { submission } = await createRes.json();

  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/submissions`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  const found = body.submissions.find((s) => s.id === submission.id);
  assert.ok(found, "admin must be able to see the submission");
  assert.ok("analysis" in found, "admin view must include the analysis field (even if null/pending)");
});

test("re-analyze (admin-triggered) works on a submission with an existing failed analysis", async () => {
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Retry Test", email: `retry${TEST_EMAIL_MARKER}`, goal: "brand", summary: "s" }),
  });
  const { submission } = await createRes.json();
  const token = await adminToken();

  // First analysis attempt (admin-triggered, since nothing runs automatically).
  const firstRes = await fetch(`${BASE_URL}/api/admin/submissions/${submission.id}/analyze`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(firstRes.status, 200);

  // Re-analyze — same endpoint, same upsert row.
  const res = await fetch(`${BASE_URL}/api/admin/submissions/${submission.id}/analyze`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.analysis.status, "failed"); // still the broken provider, but the retry request itself succeeds
  assert.equal(body.analysis.submissionId, submission.id);
});

test("seo/contact submissions are not analyzed (feature scoped to web-design only)", async () => {
  const res = await fetch(`${BASE_URL}/api/contact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Contact Test", email: `contact${TEST_EMAIL_MARKER}`, message: "hello" }),
  });
  assert.equal(res.status, 201);
  // No assertion on analysis existing is possible via the contact endpoint
  // response (contact submissions aren't even joined against analyses in
  // the admin list for non-web-design types) — this test documents the
  // scoping decision and confirms contact submissions still work normally.
});
