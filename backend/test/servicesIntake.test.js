// Full-stack integration tests for the multi-select "services" intake —
// same pattern as test/integration.test.js: spawns the real server against
// real local Postgres, exercises it over real HTTP. Covers the new intake
// endpoint, the new services[] admin filter, CSV export, and — critically —
// that none of this changed anything about the existing web-design/seo
// intake and filtering behavior.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");

const TEST_PORT = 8796;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_EMAIL_MARKER = "@services-intake-test.example";

const VALID_WEB_DESIGN_FIELDS = {
  goal: "brand",
  summary: "A test submission for services-intake tests.",
  brandStatus: "established",
  features: ["cms"],
  contentReadiness: "ready",
  timeline: "2-4-weeks",
};

let serverProcess;
let pool;
let singleServiceSubmissionId; // captured from the "single-service" test below, reused by the analyze-dispatch tests so they don't need their own intake POST (submissionLimiter is shared and tight across this whole file)

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
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      AI_PROVIDER: "services-intake-test-invalid-provider",
      NODE_ENV: "test",
    },
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

test("a single-service submission (ai-integration only) is saved with the right services array", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Single Service Client",
      email: `single${TEST_EMAIL_MARKER}`,
      services: ["ai-integration"],
      aiIntegration: { aiGoal: "Automate replies", businessProblem: "Too many manual emails" },
    }),
  });
  assert.equal(res.status, 201);
  const { submission } = await res.json();
  assert.equal(submission.type, "services");
  assert.deepEqual(submission.services, ["ai-integration"]);
  assert.deepEqual(submission.projectDetails.services, ["ai-integration"]);
  assert.equal(submission.projectDetails.aiIntegration.aiGoal, "Automate replies");
  singleServiceSubmissionId = submission.id;
});

test("a multi-service submission (app-building + web-management) is saved with both", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Combo Client",
      email: `combo${TEST_EMAIL_MARKER}`,
      services: ["app-building", "web-management"],
      appBuilding: { appGoal: "Booking system", coreWorkflows: "Appointments" },
      webManagement: { existingUrl: "https://example.com", helpNeeded: "Site is slow" },
    }),
  });
  assert.equal(res.status, 201);
  const { submission } = await res.json();
  assert.deepEqual(submission.services.sort(), ["app-building", "web-management"]);
});

test("web-design + ai-integration combined in one services submission reuses the exact web-design field set", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "WD Plus AI Client",
      email: `wdai${TEST_EMAIL_MARKER}`,
      services: ["web-design", "ai-integration"],
      webDesign: VALID_WEB_DESIGN_FIELDS,
      aiIntegration: { aiGoal: "Chatbot for the new site", businessProblem: "No after-hours support" },
    }),
  });
  assert.equal(res.status, 201);
  const { submission } = await res.json();
  assert.equal(submission.projectDetails.webDesign.goal, "brand");
});

test("rejects a submission with no services selected", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "No Services Client", email: `noservices${TEST_EMAIL_MARKER}` }),
  });
  assert.equal(res.status, 400);
});

test("rejects a selected service missing its required fields", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Incomplete Client",
      email: `incomplete${TEST_EMAIL_MARKER}`,
      services: ["app-building"],
      appBuilding: { appGoal: "Something" }, // missing coreWorkflows
    }),
  });
  assert.equal(res.status, 400);
});

test("silently drops an unrecognized service slug rather than storing it, and 400s if nothing valid remains", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Bad Slug Client",
      email: `badslug${TEST_EMAIL_MARKER}`,
      services: ["not-a-real-service", "<script>alert(1)</script>"],
    }),
  });
  assert.equal(res.status, 400);
});

test("still requires name and email, same as every other intake endpoint", async () => {
  const res = await fetch(`${BASE_URL}/api/intake/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ services: ["ai-integration"], aiIntegration: { aiGoal: "x", businessProblem: "y" } }),
  });
  assert.equal(res.status, 400);
});

test("admin can filter submissions by an individual service, even when it's one of several selected", async () => {
  const created = await fetch(`${BASE_URL}/api/intake/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Filter Test Client",
      email: `filtertest${TEST_EMAIL_MARKER}`,
      services: ["ai-integration", "web-management"],
      aiIntegration: { aiGoal: "x", businessProblem: "y" },
      webManagement: { existingUrl: "https://example.com", helpNeeded: "z" },
    }),
  });
  const { submission } = await created.json();

  const aiRes = await authed(`/api/admin/submissions?service=ai-integration`);
  const aiBody = await aiRes.json();
  assert.ok(aiBody.submissions.some((s) => s.id === submission.id));

  const wmRes = await authed(`/api/admin/submissions?service=web-management`);
  const wmBody = await wmRes.json();
  assert.ok(wmBody.submissions.some((s) => s.id === submission.id));

  const appRes = await authed(`/api/admin/submissions?service=app-building`);
  const appBody = await appRes.json();
  assert.ok(!appBody.submissions.some((s) => s.id === submission.id));
});

test("an invalid service filter value is ignored (no 400, no crash), not treated as a real filter", async () => {
  const res = await authed(`/api/admin/submissions?service=totally-made-up`);
  assert.equal(res.status, 200);
});

test("CSV export includes the services column and honors the service filter", async () => {
  await fetch(`${BASE_URL}/api/intake/services`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "CSV Test Client",
      email: `csvtest${TEST_EMAIL_MARKER}`,
      services: ["app-building"],
      appBuilding: { appGoal: "x", coreWorkflows: "y" },
    }),
  });

  const res = await authed(`/api/admin/submissions/export?service=app-building`);
  assert.equal(res.status, 200);
  const csv = await res.text();
  assert.ok(csv.startsWith("id,type,services,status"));
  assert.ok(csv.includes("csvtest" + TEST_EMAIL_MARKER));
  assert.ok(csv.includes("app-building"));
});

test("backward compatibility: a web-design submission through its own dedicated form is unaffected — still type=web-design, filterable by type, and now also filterable by service=web-design", async () => {
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Legacy WD Client", email: `legacywd${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS }),
  });
  assert.equal(createRes.status, 201);
  const { submission } = await createRes.json();
  assert.equal(submission.type, "web-design");
  // makeIntakeHandler populates this for web-design/seo the same way the
  // one-time migration backfill does for pre-existing rows
  // (config/database.js) — so every web-design submission, old or new,
  // shows up under the new service filter pill consistently.
  assert.deepEqual(submission.services, ["web-design"]);

  const listRes = await authed(`/api/admin/submissions?type=web-design`);
  const listBody = await listRes.json();
  assert.ok(listBody.submissions.some((s) => s.id === submission.id));

  const serviceListRes = await authed(`/api/admin/submissions?service=web-design`);
  const serviceListBody = await serviceListRes.json();
  assert.ok(serviceListBody.submissions.some((s) => s.id === submission.id));
});

test("AI analysis is dispatched correctly for a 'services' submission — no longer rejected as an unsupported type", async () => {
  assert.ok(singleServiceSubmissionId, "expected the single-service test to have run first and captured an id");
  // services/runAnalysis.js never throws (same design as before this
  // feature — a failed attempt is recorded as analysis.status="failed" and
  // returned normally, always HTTP 200). AI_PROVIDER is deliberately
  // broken for this whole suite, so a failed status with an
  // "unknown_provider" error — not the 400 "unsupported type" this would
  // have gotten before ANALYSIS_FN_BY_TYPE recognized "services" — is what
  // proves the dispatch actually reached analyzeServicesSubmission.
  const res = await authed(`/api/admin/submissions/${singleServiceSubmissionId}/analyze`, { method: "POST" });
  assert.equal(res.status, 200);
  const { analysis } = await res.json();
  assert.equal(analysis.status, "failed");
  assert.ok(analysis.error.includes("unknown_provider"));
});
// "seo submissions still correctly rejected as unanalyzable" is already
// covered by test/integration.test.js — not duplicated here, since every
// intake POST in this file shares submissionLimiter's tight 10/hour cap.
