// Full-stack integration tests for the AI control plane's admin routes
// (GET/POST /api/admin/guardian/ai/*, GET/POST /api/admin/guardian/events*)
// — same spawn-the-real-server pattern as the other integration test
// files. Confirms authorization is enforced server-side (not just hidden
// in the UI) and that the full disable → blocked-reenable →
// acknowledge → reenable flow works over real HTTP, not just at the
// aiControl.js module level (already covered directly in
// test/aiControl.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");

const TEST_PORT = 8804;
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

async function authed(pathAndQuery, options = {}) {
  const token = await adminToken();
  return fetch(`${BASE_URL}${pathAndQuery}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
}

async function resetControlState() {
  await pool.query("DELETE FROM security_events");
  await pool.query("DELETE FROM ai_control_state WHERE id > 1");
  await pool.query("UPDATE ai_control_state SET state = 'ENABLED', reason = 'test reset', source = 'system' WHERE id = 1");
}

test.before(async () => {
  serverProcess = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: "test" },
    stdio: "ignore",
  });
  await waitForServer(BASE_URL);
  pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/client_portal_dev" });
  await resetControlState();
});

test.beforeEach(resetControlState);
test.afterEach(resetControlState);

test.after(async () => {
  await pool.end();
  serverProcess.kill();
});

test("GET /guardian/ai/state requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/ai/state`);
  assert.equal(res.status, 401);
});

test("POST /guardian/ai/disable requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/ai/disable`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("POST /guardian/ai/lockdown requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/ai/lockdown`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("POST /guardian/ai/enable requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/ai/enable`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("GET /guardian/events requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/events`);
  assert.equal(res.status, 401);
});

test("POST /guardian/events/:id/acknowledge requires a JWT", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/events/1/acknowledge`, { method: "POST" });
  assert.equal(res.status, 401);
});

test("a garbage/invalid token is rejected the same way as no token", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/ai/state`, { headers: { Authorization: "Bearer not-a-real-token" } });
  assert.equal(res.status, 401);
});

test("the full flow: state starts ENABLED, disable, state reflects it, re-enable, state reflects that too", async () => {
  const stateRes1 = await authed("/api/admin/guardian/ai/state");
  assert.equal((await stateRes1.json()).state, "ENABLED");

  const disableRes = await authed("/api/admin/guardian/ai/disable", { method: "POST", body: JSON.stringify({ reason: "route test" }) });
  assert.equal(disableRes.status, 200);
  const disabled = await disableRes.json();
  assert.equal(disabled.state, "DISABLED");
  assert.equal(disabled.reason, "route test");

  const stateRes2 = await authed("/api/admin/guardian/ai/state");
  assert.equal((await stateRes2.json()).state, "DISABLED");

  const enableRes = await authed("/api/admin/guardian/ai/enable", { method: "POST", body: JSON.stringify({ reason: "route test done" }) });
  assert.equal(enableRes.status, 200);
  assert.equal((await enableRes.json()).state, "ENABLED");
});

test("lockdown then enable is blocked with 409 until the CRITICAL event is acknowledged, then succeeds", async () => {
  const lockdownRes = await authed("/api/admin/guardian/ai/lockdown", { method: "POST", body: JSON.stringify({ reason: "route test lockdown" }) });
  assert.equal(lockdownRes.status, 200);

  const blockedEnableRes = await authed("/api/admin/guardian/ai/enable", { method: "POST", body: JSON.stringify({ reason: "trying" }) });
  assert.equal(blockedEnableRes.status, 409);
  const blockedBody = await blockedEnableRes.json();
  assert.ok(blockedBody.blockingEvent, "the 409 response should identify the blocking event");
  assert.equal(blockedBody.blockingEvent.eventType, "ai_state_changed_to_lockdown");

  const ackRes = await authed(`/api/admin/guardian/events/${blockedBody.blockingEvent.id}/acknowledge`, { method: "POST" });
  assert.equal(ackRes.status, 200);
  assert.ok((await ackRes.json()).acknowledgedAt);

  const enableRes = await authed("/api/admin/guardian/ai/enable", { method: "POST", body: JSON.stringify({ reason: "acknowledged now" }) });
  assert.equal(enableRes.status, 200);
  assert.equal((await enableRes.json()).state, "ENABLED");
});

test("GET /guardian/events returns recent events, newest first", async () => {
  await authed("/api/admin/guardian/ai/disable", { method: "POST", body: JSON.stringify({ reason: "event order test 1" }) });
  await new Promise((r) => setTimeout(r, 20));
  await authed("/api/admin/guardian/ai/enable", { method: "POST", body: JSON.stringify({ reason: "event order test 2" }) });

  const res = await authed("/api/admin/guardian/events?limit=5");
  assert.equal(res.status, 200);
  const { events } = await res.json();
  assert.ok(events.length >= 2);
  assert.ok(new Date(events[0].createdAt) >= new Date(events[1].createdAt));
});

test("acknowledging a nonexistent event id returns 404", async () => {
  const res = await authed("/api/admin/guardian/events/999999999/acknowledge", { method: "POST" });
  assert.equal(res.status, 404);
});
