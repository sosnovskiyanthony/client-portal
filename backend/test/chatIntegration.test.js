// Full-stack integration tests for the AI chat feature — same pattern as
// test/contractIntegration.test.js: spawns the real server as a child
// process against real local Postgres, exercises it over real HTTP.
// AI_PROVIDER is overridden to a nonexistent provider, same reasoning as
// that file: makes "does a chat/analyze call fail gracefully" a fast,
// deterministic assertion regardless of whether Ollama is installed. The
// success path (a real reply, a real generated analysis) was verified
// separately, live, against real local Ollama during development — this
// suite proves the wiring, auth, persistence, and error-handling around it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");

const TEST_PORT = 8797;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_EMAIL_MARKER = "@chat-integration-test.example";

const VALID_WEB_DESIGN_FIELDS = {
  goal: "brand",
  summary: "A test submission for chat integration tests.",
  brandStatus: "established",
  features: ["cms"],
  contentReadiness: "ready",
  timeline: "2-4-weeks",
};

let serverProcess;
let pool;
let testSubmissionId;

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
      AI_PROVIDER: "chat-integration-test-invalid-provider",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
  await waitForServer(BASE_URL);
  pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/client_portal_dev" });

  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Chat Test Client", email: `client${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS }),
  });
  const { submission } = await createRes.json();
  testSubmissionId = submission.id;
});

test.after(async () => {
  await pool.query(`DELETE FROM submissions WHERE email LIKE $1`, [`%${TEST_EMAIL_MARKER}`]);
  await pool.end();
  serverProcess.kill();
});

test("unauthorized (no token) cannot read or send chat, or run paste-and-analyze, scoped or standalone", async () => {
  const noToken = { headers: { "Content-Type": "application/json" } };
  const getHistory = await fetch(`${BASE_URL}/api/admin/submissions/${testSubmissionId}/chat`);
  assert.equal(getHistory.status, 401);

  const sendMessage = await fetch(`${BASE_URL}/api/admin/submissions/${testSubmissionId}/chat`, {
    method: "POST",
    ...noToken,
    body: JSON.stringify({ message: "hi" }),
  });
  assert.equal(sendMessage.status, 401);

  const analyzeScoped = await fetch(`${BASE_URL}/api/admin/submissions/${testSubmissionId}/chat/analyze`, {
    method: "POST",
    ...noToken,
    body: JSON.stringify({ text: "client notes" }),
  });
  assert.equal(analyzeScoped.status, 401);

  const analyzeStandalone = await fetch(`${BASE_URL}/api/admin/chat/analyze`, {
    method: "POST",
    ...noToken,
    body: JSON.stringify({ text: "client notes", requestId: "abc" }),
  });
  assert.equal(analyzeStandalone.status, 401);

  const regenerate = await fetch(`${BASE_URL}/api/admin/submissions/${testSubmissionId}/chat/regenerate`, {
    method: "POST",
    ...noToken,
  });
  assert.equal(regenerate.status, 401);
});

test("chat history starts empty for a fresh submission", async () => {
  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.messages, []);
});

test("chat history for a nonexistent submission 404s", async () => {
  const res = await authed(`/api/admin/submissions/999999999/chat`);
  assert.equal(res.status, 404);
});

test("sending an empty message is rejected with 400, nothing is persisted", async () => {
  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message: "   " }),
  });
  assert.equal(res.status, 400);
});

test("sending a chat message with a broken AI provider returns 502, but the admin's own message is still persisted", async () => {
  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message: "Why did you rate this medium complexity?" }),
  });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.ok(body.error);

  const historyRes = await authed(`/api/admin/submissions/${testSubmissionId}/chat`);
  const { messages } = await historyRes.json();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "admin");
  assert.equal(messages[0].content, "Why did you rate this medium complexity?");
});

test("regenerate is rejected with 400 when the history doesn't end with an assistant reply", async () => {
  // The previous test left exactly one admin message (its reply failed) —
  // nothing valid to regenerate yet.
  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat/regenerate`, { method: "POST" });
  assert.equal(res.status, 400);
});

test("regenerate on a submission with no chat history at all is rejected with 400", async () => {
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "No History Client", email: `nohistory${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS }),
  });
  const { submission } = await createRes.json();

  const res = await authed(`/api/admin/submissions/${submission.id}/chat/regenerate`, { method: "POST" });
  assert.equal(res.status, 400);
});

test("regenerate on a nonexistent submission 404s", async () => {
  const res = await authed(`/api/admin/submissions/999999999/chat/regenerate`, { method: "POST" });
  assert.equal(res.status, 404);
});

test("unauthorized (no token) cannot update the analysis from a conversation", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/submissions/${testSubmissionId}/chat/update-analysis`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("update-analysis is rejected with 400 when no completed analysis exists yet", async () => {
  // AI_PROVIDER is deliberately broken for this whole suite, so no
  // submission here ever successfully completes an analysis — this
  // precondition check has to fire before any AI call is even attempted.
  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat/update-analysis`, { method: "POST" });
  assert.equal(res.status, 400);
});

test("update-analysis on a nonexistent submission 404s", async () => {
  const res = await authed(`/api/admin/submissions/999999999/chat/update-analysis`, { method: "POST" });
  assert.equal(res.status, 404);
});

test("unauthorized (no token) cannot check research availability", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/chat/research-status`);
  assert.equal(res.status, 401);
});

test("research-status reports unavailable when TAVILY_API_KEY/AI_PROVIDER aren't both configured for it", async () => {
  // This whole suite runs with AI_PROVIDER deliberately set to an invalid
  // provider (not "ollama") — research requires AI_PROVIDER=ollama, so
  // this should always read as unavailable in this test environment
  // regardless of whether TAVILY_API_KEY happens to be set locally.
  const res = await authed(`/api/admin/chat/research-status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.available, false);
});

test("sending a chat message with research:true when research isn't configured returns 502 with a clear code", async () => {
  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message: "Can you look this up for me?", research: true }),
  });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.code, "research_unavailable");
});

test("scoped paste-and-analyze with a broken AI provider returns 502 and saves nothing", async () => {
  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat/analyze`, {
    method: "POST",
    body: JSON.stringify({ text: "Client emailed: we need a new site for our bakery." }),
  });
  assert.equal(res.status, 502);

  const historyRes = await authed(`/api/admin/submissions/${testSubmissionId}/chat`);
  const { messages } = await historyRes.json();
  assert.ok(!messages.some((m) => m.role === "analysis"));
});

test("scoped paste-and-analyze rejects an empty paste with 400", async () => {
  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat/analyze`, {
    method: "POST",
    body: JSON.stringify({ text: "   " }),
  });
  assert.equal(res.status, 400);
});

test("standalone paste-and-analyze requires a requestId", async () => {
  const res = await authed(`/api/admin/chat/analyze`, {
    method: "POST",
    body: JSON.stringify({ text: "some client notes" }),
  });
  assert.equal(res.status, 400);
});

test("standalone paste-and-analyze with a broken AI provider returns 502", async () => {
  const res = await authed(`/api/admin/chat/analyze`, {
    method: "POST",
    body: JSON.stringify({ text: "Client emailed: we need a new site.", requestId: "test-request-1" }),
  });
  assert.equal(res.status, 502);
});

test("saveChatAnalysis rejects a result that doesn't match AnalysisSchema", async () => {
  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat/analyze/save`, {
    method: "POST",
    body: JSON.stringify({ result: { project_summary: "only this field" } }),
  });
  assert.equal(res.status, 400);
});

test("saveChatAnalysis with a valid, schema-conforming result overwrites this submission's analysis", async () => {
  const validResult = {
    project_summary: "A bakery site.", business_summary: "b", primary_goal: "g", secondary_goals: [],
    target_audience: "a", recommended_website_type: "t", recommended_site_structure: "s",
    recommended_pages: [], required_features: [], recommended_features: [],
    technical_requirements: [], cms_recommendation: "c", integrations: [], seo_opportunities: [],
    analytics_recommendations: [], content_requirements: [], brand_requirements: "b",
    ux_considerations: [], accessibility_considerations: [], performance_considerations: [],
    security_considerations: [], potential_risks: [], missing_information: [],
    critical_questions: [], nice_to_have_questions: [],
    scope_recommendation: { scope: "small", reasoning: "r" }, complexity: "low",
    timeline_recommendation: { discovery: "1w", design: "1w", development: "1w", qa_and_launch: "1w" },
    priority: "low", potential_additional_services: [], internal_notes: [], reasoning: [], confidence: 0.5,
  };

  const res = await authed(`/api/admin/submissions/${testSubmissionId}/chat/analyze/save`, {
    method: "POST",
    body: JSON.stringify({ result: validResult, provider: "ollama", model: "qwen2.5:7b" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.analysis.status, "completed");
  assert.equal(body.analysis.result.project_summary, "A bakery site.");

  const viewRes = await authed(`/api/admin/submissions?type=web-design`);
  const listBody = await viewRes.json();
  const saved = listBody.submissions.find((s) => s.id === testSubmissionId);
  assert.equal(saved.analysis.status, "completed");
});

test("saveStandaloneAnalysisAsSubmission rejects a missing rawText even with a valid result", async () => {
  const validResult = {
    project_summary: "s", business_summary: "s", primary_goal: "g", secondary_goals: [],
    target_audience: "a", recommended_website_type: "t", recommended_site_structure: "s",
    recommended_pages: [], required_features: [], recommended_features: [],
    technical_requirements: [], cms_recommendation: "c", integrations: [], seo_opportunities: [],
    analytics_recommendations: [], content_requirements: [], brand_requirements: "b",
    ux_considerations: [], accessibility_considerations: [], performance_considerations: [],
    security_considerations: [], potential_risks: [], missing_information: [],
    critical_questions: [], nice_to_have_questions: [],
    scope_recommendation: { scope: "small", reasoning: "r" }, complexity: "low",
    timeline_recommendation: { discovery: "1w", design: "1w", development: "1w", qa_and_launch: "1w" },
    priority: "low", potential_additional_services: [], internal_notes: [], reasoning: [], confidence: 0.5,
  };
  const res = await authed(`/api/admin/chat/analyze/save-as-submission`, {
    method: "POST",
    body: JSON.stringify({ result: validResult }),
  });
  assert.equal(res.status, 400);
});

test("saveStandaloneAnalysisAsSubmission creates a real, re-analyzable web-design submission plus its analysis", async () => {
  const validResult = {
    project_summary: "A standalone-pasted lead.", business_summary: "b", primary_goal: "g", secondary_goals: [],
    target_audience: "a", recommended_website_type: "t", recommended_site_structure: "s",
    recommended_pages: [], required_features: [], recommended_features: [],
    technical_requirements: [], cms_recommendation: "c", integrations: [], seo_opportunities: [],
    analytics_recommendations: [], content_requirements: [], brand_requirements: "b",
    ux_considerations: [], accessibility_considerations: [], performance_considerations: [],
    security_considerations: [], potential_risks: [], missing_information: [],
    critical_questions: [], nice_to_have_questions: [],
    scope_recommendation: { scope: "small", reasoning: "r" }, complexity: "low",
    timeline_recommendation: { discovery: "1w", design: "1w", development: "1w", qa_and_launch: "1w" },
    priority: "low", potential_additional_services: [], internal_notes: [], reasoning: [], confidence: 0.5,
  };

  const res = await authed(`/api/admin/chat/analyze/save-as-submission`, {
    method: "POST",
    body: JSON.stringify({
      result: validResult,
      rawText: "Hey, we run a small bakery and want a new site.",
      clientName: "Standalone Test Client",
      email: `standalone${TEST_EMAIL_MARKER}`,
      provider: "ollama",
      model: "qwen2.5:7b",
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.submission.type, "web-design");
  assert.equal(body.submission.clientName, "Standalone Test Client");
  assert.equal(body.analysis.status, "completed");
  assert.equal(body.analysis.result.project_summary, "A standalone-pasted lead.");

  // Provably indistinguishable from a normal submission afterward: it shows
  // up in the regular admin list, with its analysis, like any other.
  const listRes = await authed(`/api/admin/submissions?type=web-design`);
  const listBody = await listRes.json();
  const found = listBody.submissions.find((s) => s.id === body.submission.id);
  assert.ok(found);
  assert.equal(found.analysis.status, "completed");
});
