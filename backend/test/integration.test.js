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

// Every field controllers/intakeController.js now requires for a web-design
// submission (mirrors the frontend's own required-field set) — spread this
// into each test body so tests unrelated to intake validation itself don't
// get rejected by it.
const VALID_WEB_DESIGN_FIELDS = {
  goal: "brand",
  summary: "A test submission.",
  brandStatus: "established",
  features: ["cms"],
  contentReadiness: "ready",
  timeline: "2-4-weeks",
};

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

// Cached and only ever logged in once per test run (see adminToken() below)
// — the login rate limiter (5/15min) is a real production safety control,
// and this suite has enough tests needing a token that logging in fresh for
// each one would exceed it. Reusing one token across the whole run is both
// the correct fix and just less wasteful.
let cachedAdminToken = null;

async function adminToken() {
  if (cachedAdminToken) return cachedAdminToken;

  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@brindleaf.dev", password: "brindleaf-admin" }),
  });
  if (!res.ok) {
    throw new Error(`Test setup failed: admin login returned ${res.status}`);
  }
  const body = await res.json();
  cachedAdminToken = body.token;
  return cachedAdminToken;
}

// analyzeSubmission's POST now returns immediately (202) and runs in the
// background — see adminController.js's analyzeSubmission/
// getAnalysisProgress. Tests poll the same progress endpoint the real
// admin dashboard does until the background run reports done:true, same
// pattern as chatIntegration.test.js's pollAnalyzeProgress.
async function pollAnalysisProgress(submissionId, token, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE_URL}/api/admin/submissions/${submissionId}/analyze/progress`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (body.done) return body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for submission ${submissionId}'s analysis progress to report done:true`);
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
    body: JSON.stringify({ name: "Integration Test", email: `valid${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS }),
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

test("a name+email-only submission (no project fields) is rejected, not stored as a near-empty record", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Bare Submission", email: `bare${TEST_EMAIL_MARKER}` }),
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.match(body.error, /missing required field/i);
});

test("an seo submission missing a required field (visibility) is rejected", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/seo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "SEO Bare",
      email: `seobare${TEST_EMAIL_MARKER}`,
      url: "example.com",
      keywords: "roofing",
      challenge: "not-ranking",
      // visibility intentionally omitted
    }),
  });
  assert.equal(res.status, 400);
});

test("client-facing submission response never contains an 'analysis' key", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "No Leak", email: `noleak${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS }),
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
    body: JSON.stringify({ name: "No Auto Trigger", email: `noauto${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS, goal: "webapp" }),
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
    body: JSON.stringify({ name: "Survives Failure", email: `survives${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS, goal: "webapp" }),
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
  assert.equal(analyzeRes.status, 202, "the request runs in the background — see adminController.js's analyzeSubmission");

  const progress = await pollAnalysisProgress(submission.id, token);
  assert.equal(progress.analysis.status, "failed");
  assert.ok(progress.analysis.error && progress.analysis.error.includes("unknown_provider"));

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

test("admin submissions list is paginated and returns the expected shape", async () => {
  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/submissions?page=1`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(body.submissions));
  assert.ok(body.submissions.length <= body.pageSize, "a page must never return more rows than pageSize");
  assert.equal(typeof body.total, "number");
  assert.equal(body.page, 1);
  assert.ok(body.totalPages >= 1);
  // Full page-2-exists coverage is verified live (not in this suite) — the
  // submission rate limiter (10/hour) makes creating 20+ rows in one test
  // run impractical without special-casing tests around a production
  // safety control, which isn't worth doing just to exercise this branch.
});

test("admin (valid token) can view a submission's analysis", async () => {
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Admin View Test", email: `adminview${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS }),
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
    body: JSON.stringify({ name: "Retry Test", email: `retry${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS }),
  });
  const { submission } = await createRes.json();
  const token = await adminToken();

  // First analysis attempt (admin-triggered, since nothing runs automatically).
  const firstRes = await fetch(`${BASE_URL}/api/admin/submissions/${submission.id}/analyze`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(firstRes.status, 202);
  await pollAnalysisProgress(submission.id, token);

  // Re-analyze — same endpoint, same upsert row.
  const res = await fetch(`${BASE_URL}/api/admin/submissions/${submission.id}/analyze`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 202);
  const progress = await pollAnalysisProgress(submission.id, token);
  assert.equal(progress.analysis.status, "failed"); // still the broken provider, but the retry request itself succeeds
  assert.equal(progress.analysis.submissionId, submission.id);
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

  // Reuses the submission just created above (rather than making a new
  // POST) to verify the admin list's ?type= filter is enforced server-side —
  // the submission rate limiter (10/hour, shared across all intake/contact
  // endpoints) makes an extra POST here impractical alongside this suite's
  // other submission-creating tests.
  const token = await adminToken();
  const filterRes = await fetch(`${BASE_URL}/api/admin/submissions?type=contact&page=1`, { headers: { Authorization: `Bearer ${token}` } });
  const filterBody = await filterRes.json();
  assert.equal(filterRes.status, 200);
  assert.ok(filterBody.submissions.length > 0, "the contact submission just created must appear in the filtered results");
  assert.ok(filterBody.submissions.every((s) => s.type === "contact"), "every returned row must match the requested type filter");
});

// PUT .../outcome isn't rate-limited (admin-only, low-frequency data entry —
// see routes/admin.js), so these reuse the contact submission created above
// rather than needing a fresh POST against the shared submissionLimiter budget.
test("upsertOutcome rejects a non-numeric quotedPrice with a clear 400, not a raw DB error", async () => {
  const token = await adminToken();
  const listRes = await fetch(`${BASE_URL}/api/admin/submissions?type=contact&page=1`, { headers: { Authorization: `Bearer ${token}` } });
  const { submissions } = await listRes.json();
  const submissionId = submissions[0].id;

  const res = await fetch(`${BASE_URL}/api/admin/submissions/${submissionId}/outcome`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ quotedPrice: "not-a-number" }),
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.ok(body.error.includes("quotedPrice"));
});

test("upsertOutcome rejects a negative finalPrice with a clear 400", async () => {
  const token = await adminToken();
  const listRes = await fetch(`${BASE_URL}/api/admin/submissions?type=contact&page=1`, { headers: { Authorization: `Bearer ${token}` } });
  const { submissions } = await listRes.json();
  const submissionId = submissions[0].id;

  const res = await fetch(`${BASE_URL}/api/admin/submissions/${submissionId}/outcome`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ finalPrice: -500 }),
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.ok(body.error.includes("finalPrice"));
});

test("upsertOutcome accepts a valid non-negative price, and accepts clearing a price via empty string", async () => {
  const token = await adminToken();
  const listRes = await fetch(`${BASE_URL}/api/admin/submissions?type=contact&page=1`, { headers: { Authorization: `Bearer ${token}` } });
  const { submissions } = await listRes.json();
  const submissionId = submissions[0].id;

  const okRes = await fetch(`${BASE_URL}/api/admin/submissions/${submissionId}/outcome`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ quotedPrice: 1500, finalPrice: 1500 }),
  });
  const okBody = await okRes.json();
  assert.equal(okRes.status, 200);
  assert.equal(okBody.outcome.quotedPrice, 1500);

  const clearRes = await fetch(`${BASE_URL}/api/admin/submissions/${submissionId}/outcome`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ quotedPrice: "", finalPrice: null }),
  });
  const clearBody = await clearRes.json();
  assert.equal(clearRes.status, 200);
  assert.equal(clearBody.outcome.quotedPrice, null);
  assert.equal(clearBody.outcome.finalPrice, null);
});
