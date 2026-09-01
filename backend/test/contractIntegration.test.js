// Full-stack integration tests for the Contracts feature — same pattern as
// test/integration.test.js: spawns the real server as a child process
// against real local Postgres, exercises it over real HTTP. AI_PROVIDER is
// overridden to a nonexistent provider for the same reason that file does
// it: makes "does review/generate fail gracefully" a fast, deterministic
// assertion, and this suite runs the same whether or not Ollama is
// installed. The success path for AI review/generation was verified
// separately, live, against real local Ollama (see the phase 5/6 commits)
// — that's not something this suite re-proves.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");

const TEST_PORT = 8798;
const BASE_URL = `http://localhost:${TEST_PORT}`;
const TEST_EMAIL_MARKER = "@contract-integration-test.example";

const VALID_WEB_DESIGN_FIELDS = {
  goal: "brand",
  summary: "A test submission for contract integration tests.",
  brandStatus: "established",
  features: ["cms"],
  contentReadiness: "ready",
  timeline: "2-4-weeks",
};

let serverProcess;
let pool;
let testSubmissionId;
const createdContractIds = [];

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

async function createTestContract() {
  const res = await authed(`/api/admin/contracts/from-submission/${testSubmissionId}`, { method: "POST" });
  const body = await res.json();
  assert.equal(res.status, 201);
  createdContractIds.push(body.contract.id);
  return body.contract;
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

  // One real submission this whole suite's contracts are created from.
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Contract Test Client", email: `client${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS }),
  });
  const { submission } = await createRes.json();
  testSubmissionId = submission.id;
});

test.after(async () => {
  // Contracts first (FK -> submissions), then the submission itself.
  if (createdContractIds.length > 0) {
    await pool.query(`DELETE FROM contracts WHERE id = ANY($1::int[])`, [createdContractIds]);
  }
  await pool.query(`DELETE FROM submissions WHERE email LIKE $1`, [`%${TEST_EMAIL_MARKER}`]);
  await pool.end();
  serverProcess.kill();
});

// ---------- Authorization ----------

test("unauthorized (no token) cannot list, create, or act on contracts", async () => {
  const listRes = await fetch(`${BASE_URL}/api/admin/contracts`);
  assert.equal(listRes.status, 401);

  const createRes = await fetch(`${BASE_URL}/api/admin/contracts/from-submission/${testSubmissionId}`, { method: "POST" });
  assert.equal(createRes.status, 401);

  const reviewRes = await fetch(`${BASE_URL}/api/admin/contracts/1/review`, { method: "POST" });
  assert.equal(reviewRes.status, 401);

  const featuresRes = await fetch(`${BASE_URL}/api/admin/contract-features`);
  assert.equal(featuresRes.status, 401);
});

test("unauthorized (garbage token) cannot list contracts", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/contracts`, { headers: { Authorization: "Bearer not-a-real-token" } });
  assert.equal(res.status, 401);
});

// ---------- CRUD + numbering ----------

test("create-from-submission imports client info but does not fabricate agreed terms", async () => {
  const contract = await createTestContract();
  assert.equal(contract.clientName, "Contract Test Client");
  assert.equal(contract.clientEmail, `client${TEST_EMAIL_MARKER}`);
  assert.equal(contract.status, "draft");
  assert.equal(contract.price, null, "price must never be auto-filled from a submission");
  assert.equal(contract.finalContent, null);
});

test("two contracts from the same submission get distinct, correctly-formatted contract numbers", async () => {
  const a = await createTestContract();
  const b = await createTestContract();
  assert.notEqual(a.contractNumber, b.contractNumber);
  assert.match(a.contractNumber, /^CONTRACT-\d{4}-\d{4}$/);
  assert.match(b.contractNumber, /^CONTRACT-\d{4}-\d{4}$/);
});

test("create-from-submission for a nonexistent submission returns 404", async () => {
  const res = await authed("/api/admin/contracts/from-submission/9999999", { method: "POST" });
  assert.equal(res.status, 404);
});

test("update rejects invalid data with a clear 400, not a raw DB error", async () => {
  const contract = await createTestContract();

  const badEmail = await authed(`/api/admin/contracts/${contract.id}`, { method: "PATCH", body: JSON.stringify({ clientEmail: "not-an-email" }) });
  assert.equal(badEmail.status, 400);

  const negPrice = await authed(`/api/admin/contracts/${contract.id}`, { method: "PATCH", body: JSON.stringify({ price: -100 }) });
  assert.equal(negPrice.status, 400);

  const overDeposit = await authed(`/api/admin/contracts/${contract.id}`, { method: "PATCH", body: JSON.stringify({ depositPercentage: 150 }) });
  assert.equal(overDeposit.status, 400);
});

test("update saves a JSONB array field (clientResponsibilities) correctly — regression test for the pg array-literal-vs-JSON bug", async () => {
  const contract = await createTestContract();
  const res = await authed(`/api/admin/contracts/${contract.id}`, {
    method: "PATCH",
    body: JSON.stringify({ clientResponsibilities: ["Provide content", "Approve designs"] }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body.contract.clientResponsibilities, ["Provide content", "Approve designs"]);
});

test("delete removes a non-finalized contract", async () => {
  const contract = await createTestContract();
  const delRes = await authed(`/api/admin/contracts/${contract.id}`, { method: "DELETE" });
  assert.equal(delRes.status, 204);

  const getRes = await authed(`/api/admin/contracts/${contract.id}`);
  assert.equal(getRes.status, 404);

  // Already gone — don't double-delete in test.after.
  createdContractIds.splice(createdContractIds.indexOf(contract.id), 1);
});

// ---------- Feature catalog + selected features ----------

test("feature catalog is grouped by category and excludes deactivated features by default", async () => {
  const res = await authed("/api/admin/contract-features");
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.byCategory["Website Pages"].length > 0);
  assert.ok(body.features.every((f) => f.active !== false));
});

test("scope of work: set, add custom, remove, and replace-the-whole-set all work correctly", async () => {
  const contract = await createTestContract();

  const setRes = await authed(`/api/admin/contracts/${contract.id}/features`, {
    method: "PATCH",
    body: JSON.stringify({ features: [{ category: "Website Pages", name: "Homepage" }] }),
  });
  const setBody = await setRes.json();
  assert.equal(setRes.status, 200);
  assert.equal(setBody.selectedFeatures.length, 1);

  const customRes = await authed(`/api/admin/contracts/${contract.id}/features/custom`, {
    method: "POST",
    body: JSON.stringify({ category: "Custom", name: "Logo redesign", price: 300 }),
  });
  assert.equal(customRes.status, 201);

  const getRes = await authed(`/api/admin/contracts/${contract.id}`);
  const getBody = await getRes.json();
  assert.equal(getBody.selectedFeatures.length, 2);

  // Replace-the-whole-set wipes the previous selection entirely.
  const replaceRes = await authed(`/api/admin/contracts/${contract.id}/features`, {
    method: "PATCH",
    body: JSON.stringify({ features: [{ category: "SEO", name: "Basic On-Page SEO" }] }),
  });
  const replaceBody = await replaceRes.json();
  assert.equal(replaceRes.status, 200);
  assert.equal(replaceBody.selectedFeatures.length, 1);
  assert.equal(replaceBody.selectedFeatures[0].name, "Basic On-Page SEO");
});

// ---------- AI review/generation failure handling (deterministic, via the invalid AI provider) ----------

test("AI review with a broken provider returns 502 with a classified error, never a fabricated result", async () => {
  const contract = await createTestContract();
  const res = await authed(`/api/admin/contracts/${contract.id}/review`, { method: "POST" });
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.ok(body.error);
  assert.equal(body.code, "unknown_provider");

  // The contract itself must be untouched by the failed attempt.
  const getRes = await authed(`/api/admin/contracts/${contract.id}`);
  const getBody = await getRes.json();
  assert.equal(getBody.contract.reviewResult, null);
});

test("AI generation with a broken provider returns 502, contract stays in draft status", async () => {
  const contract = await createTestContract();
  const res = await authed(`/api/admin/contracts/${contract.id}/generate`, { method: "POST" });
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.code, "unknown_provider");

  const getRes = await authed(`/api/admin/contracts/${contract.id}`);
  const getBody = await getRes.json();
  assert.equal(getBody.contract.status, "draft", "a failed generation must never advance status");
  assert.equal(getBody.contract.generatedContent, null);
});

// ---------- Approve/finalize state machine ----------

test("approve is rejected with no draft content, finalize is rejected before approval", async () => {
  const contract = await createTestContract();

  const approveRes = await authed(`/api/admin/contracts/${contract.id}/approve`, { method: "POST" });
  assert.equal(approveRes.status, 400);

  const finalizeRes = await authed(`/api/admin/contracts/${contract.id}/finalize`, { method: "POST" });
  assert.equal(finalizeRes.status, 400);
});

test("full approve -> finalize -> delete-blocked sequence works once content exists, and every step is audit-logged", async () => {
  const contract = await createTestContract();

  // Seed draft content directly (the AI success path is verified live
  // elsewhere — this test is about the state machine, not AI quality).
  const Contract = require("../models/Contract");
  await Contract.setGeneratedContent(contract.id, { sections: [{ key: "parties", title: "Parties", content: "Test." }] });

  const approveRes = await authed(`/api/admin/contracts/${contract.id}/approve`, { method: "POST" });
  const approveBody = await approveRes.json();
  assert.equal(approveRes.status, 200);
  assert.equal(approveBody.contract.status, "approved");
  assert.ok(approveBody.contract.approvedAt);

  const finalizeRes = await authed(`/api/admin/contracts/${contract.id}/finalize`, { method: "POST" });
  const finalizeBody = await finalizeRes.json();
  assert.equal(finalizeRes.status, 200);
  assert.ok(finalizeBody.contract.finalizedAt);
  assert.deepEqual(finalizeBody.contract.finalContent, { sections: [{ key: "parties", title: "Parties", content: "Test." }] });

  const versionsRes = await authed(`/api/admin/contracts/${contract.id}/versions`);
  const versionsBody = await versionsRes.json();
  assert.ok(versionsBody.versions.some((v) => v.source === "final"));

  const deleteRes = await authed(`/api/admin/contracts/${contract.id}`, { method: "DELETE" });
  assert.equal(deleteRes.status, 400, "a finalized contract must never be deletable, even via the API directly");

  const auditRes = await authed(`/api/admin/contracts/${contract.id}/audit-log`);
  const auditBody = await auditRes.json();
  const actions = auditBody.auditLog.map((e) => e.action);
  assert.ok(actions.includes("contract_created"));
  assert.ok(actions.includes("contract_approved"));
  assert.ok(actions.includes("contract_finalized"));
});

test("regression: deleting a submission with a finalized contract is blocked, not silently cascaded through the DB relationship", async () => {
  // A dedicated submission for this test — deleting the shared
  // testSubmissionId would break every other test in this file.
  const createRes = await fetch(`${BASE_URL}/api/intake/web-design`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Cascade Test Client", email: `cascade${TEST_EMAIL_MARKER}`, ...VALID_WEB_DESIGN_FIELDS }),
  });
  const { submission } = await createRes.json();

  const createContractRes = await authed(`/api/admin/contracts/from-submission/${submission.id}`, { method: "POST" });
  const { contract } = await createContractRes.json();

  const Contract = require("../models/Contract");
  await Contract.setGeneratedContent(contract.id, { sections: [{ key: "parties", title: "Parties", content: "Test." }] });
  await authed(`/api/admin/contracts/${contract.id}/approve`, { method: "POST" });
  const finalizeRes = await authed(`/api/admin/contracts/${contract.id}/finalize`, { method: "POST" });
  assert.equal(finalizeRes.status, 200);

  const deleteSubmissionRes = await authed(`/api/admin/submissions/${submission.id}`, { method: "DELETE" });
  assert.equal(deleteSubmissionRes.status, 400, "a submission with a finalized contract must not be deletable");

  // Both the submission and its finalized contract must still exist.
  const getSubmissionRes = await authed(`/api/admin/submissions?page=1`);
  const getSubmissionBody = await getSubmissionRes.json();
  assert.ok(getSubmissionBody.submissions.some((s) => s.id === submission.id), "submission must survive the blocked delete attempt");

  const getContractRes = await authed(`/api/admin/contracts/${contract.id}`);
  assert.equal(getContractRes.status, 200, "the finalized contract must still exist");

  // Direct DB cleanup — the API correctly refuses to delete either through
  // the normal endpoints, which is exactly the behavior under test.
  await pool.query(`DELETE FROM contracts WHERE id = $1`, [contract.id]);
  await pool.query(`DELETE FROM submissions WHERE id = $1`, [submission.id]);
});

test("invalid status transition is rejected", async () => {
  const contract = await createTestContract();
  const res = await authed(`/api/admin/contracts/${contract.id}/status`, { method: "POST", body: JSON.stringify({ status: "not-a-real-status" }) });
  assert.equal(res.status, 400);
});

test("regression: editing content after approval resets status to ready_for_approval, never leaves unreviewed content finalizeable", async () => {
  const contract = await createTestContract();
  const Contract = require("../models/Contract");
  await Contract.setGeneratedContent(contract.id, { sections: [{ key: "parties", title: "Parties", content: "Original." }] });

  const approveRes = await authed(`/api/admin/contracts/${contract.id}/approve`, { method: "POST" });
  assert.equal((await approveRes.json()).contract.status, "approved");

  // Admin edits the approved content directly (e.g. fixing a typo).
  const editRes = await authed(`/api/admin/contracts/${contract.id}/content`, {
    method: "PATCH",
    body: JSON.stringify({ sections: [{ key: "parties", title: "Parties", content: "Edited after approval." }] }),
  });
  const editBody = await editRes.json();
  assert.equal(editRes.status, 200);
  assert.equal(editBody.contract.status, "ready_for_approval", "an edit made after approval must force re-approval before it can be finalized");

  // Finalize must still be blocked until it's re-approved.
  const finalizeRes = await authed(`/api/admin/contracts/${contract.id}/finalize`, { method: "POST" });
  assert.equal(finalizeRes.status, 400);
});

// ---------- PDF graceful degradation ----------

test("PDF generation is rejected with no draft content, before any storage concern", async () => {
  const contract = await createTestContract();
  const res = await authed(`/api/admin/contracts/${contract.id}/pdf`, { method: "POST" });
  assert.ok(res.status === 400 || res.status === 503, `expected 400 (no content) or 503 (storage unconfigured), got ${res.status}`);
});

test("PDF signed-URL lookup 404s when no PDF has ever been generated", async () => {
  const contract = await createTestContract();
  const res = await authed(`/api/admin/contracts/${contract.id}/pdf`);
  assert.equal(res.status, 404);
});

// ---------- Email ----------

test("email draft uses the client's first name and the real contract number, changes nothing on the contract", async () => {
  const contract = await createTestContract();
  const res = await authed(`/api/admin/contracts/${contract.id}/email/draft`, { method: "POST" });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.match(body.subject, new RegExp(contract.contractNumber));
  assert.match(body.body, /^Hi Contract,/); // first name only, from "Contract Test Client"

  const getRes = await authed(`/api/admin/contracts/${contract.id}`);
  const getBody = await getRes.json();
  assert.equal(getBody.contract.status, "draft", "drafting an email must never change contract status");
});

test("email send is rejected without valid recipient/subject/body", async () => {
  const contract = await createTestContract();
  const res = await authed(`/api/admin/contracts/${contract.id}/email/send`, {
    method: "POST",
    body: JSON.stringify({ to: "not-an-email", subject: "", body: "" }),
  });
  assert.equal(res.status, 400);
});

test("email send is rejected with no draft content to attach", async () => {
  const contract = await createTestContract();
  const res = await authed(`/api/admin/contracts/${contract.id}/email/send`, {
    method: "POST",
    body: JSON.stringify({ to: "client@example.test", subject: "Subject", body: "Body" }),
  });
  assert.equal(res.status, 400);
});
