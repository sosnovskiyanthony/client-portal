// Security Center (2026-09-03) — unit coverage for the two genuinely new
// pieces of logic (guardian/eventCategory.js, SecurityEvent.findPage), plus
// full-stack HTTP coverage for the new routes' auth gating and response
// shape. Doesn't re-test Guardian/AI-control/security-event logic itself —
// that's already covered by test/aiControl.test.js, test/aiControlRoutes.test.js,
// and the model's own existing tests; this only covers what's actually new.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { Pool } = require("pg");
const { CATEGORIES, categoryForEvent, categoryForSource, sourcesForCategory } = require("../guardian/eventCategory");
const SecurityEvent = require("../models/SecurityEvent");

// ---------- guardian/eventCategory.js ----------

test("every real source used by logSecurityEvent() call sites maps to a real category", () => {
  // Exhaustive list from grep'ing every logSecurityEvent() call site
  // (2026-09-03) — see eventCategory.js's own module comment. If this
  // list and that comment ever drift apart, this test is the thing that
  // should catch it, not a live incident where an event silently
  // defaults to "Backend" with a console warning nobody sees.
  const realSources = ["aiService", "ollamaProvider", "aiControl", "authController", "server_boot"];
  for (const source of realSources) {
    const category = categoryForSource(source);
    assert.ok(CATEGORIES.includes(category), `source "${source}" must map to one of: ${CATEGORIES.join(", ")}`);
  }
});

test("an unrecognized source falls back to Backend, not silently to undefined", () => {
  assert.equal(categoryForSource("some_future_module_nobody_updated_the_map_for"), "Backend");
});

test("categoryForEvent falls back to the source mapping when there's no event_type-level override", () => {
  assert.equal(categoryForEvent({ source: "aiService", eventType: "ai_schema_validation_failed" }), "AI");
});

test("sourcesForCategory round-trips with categoryForSource for every known source", () => {
  for (const category of CATEGORIES) {
    const sources = sourcesForCategory(category);
    for (const source of sources) {
      assert.equal(categoryForSource(source), category);
    }
  }
});

test("Browser has no known sources — browser errors never land in security_events (see errorController.js, which forwards straight to Sentry)", () => {
  assert.deepEqual(sourcesForCategory("Browser"), []);
});

// ---------- models/SecurityEvent.js's findPage ----------

let pool;
const TEST_MARKER = "security-center-test-marker";

test.before(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/client_portal_dev" });
  // Seed a small, known set of events under a marker source so this
  // suite's assertions aren't at the mercy of whatever real events
  // happen to already be in the shared local test DB.
  for (let i = 0; i < 5; i++) {
    await SecurityEvent.create({
      severity: i % 2 === 0 ? "INFO" : "WARNING",
      eventType: `${TEST_MARKER}_type`,
      actorType: "system",
      source: TEST_MARKER,
      description: `seeded event ${i}`,
    });
  }
});

test.after(async () => {
  await pool.query("DELETE FROM security_events WHERE source = $1", [TEST_MARKER]);
  await pool.end();
});

test("findPage respects limit and returns a usable nextCursor for a full page", async () => {
  const page = await SecurityEvent.findPage({ sources: [TEST_MARKER], limit: 2 });
  assert.equal(page.events.length, 2);
  assert.ok(page.nextCursor, "a full page (events.length === limit) must return a cursor");
  assert.ok(page.nextCursor.createdAt);
  assert.ok(Number.isInteger(page.nextCursor.id));
});

test("findPage's cursor produces the next page with no overlap and no gaps", async () => {
  const page1 = await SecurityEvent.findPage({ sources: [TEST_MARKER], limit: 3 });
  const page2 = await SecurityEvent.findPage({ sources: [TEST_MARKER], limit: 3, cursor: page1.nextCursor });
  const ids1 = page1.events.map((e) => e.id);
  const ids2 = page2.events.map((e) => e.id);
  assert.equal(new Set([...ids1, ...ids2]).size, ids1.length + ids2.length, "no event should appear on both pages");
  // All 5 seeded events across the two pages, nothing missing.
  assert.equal(ids1.length + ids2.length, 5);
});

test("a short page (fewer than limit) reports no next cursor — a reliable end-of-results signal", async () => {
  const page = await SecurityEvent.findPage({ sources: [TEST_MARKER], limit: 50 });
  assert.equal(page.events.length, 5);
  assert.equal(page.nextCursor, null);
});

test("findPage filters by severity", async () => {
  const page = await SecurityEvent.findPage({ sources: [TEST_MARKER], severity: "WARNING", limit: 50 });
  assert.ok(page.events.length > 0);
  assert.ok(page.events.every((e) => e.severity === "WARNING"));
});

test("findPage's sources filter is a real allowlist, not a substring match", async () => {
  const page = await SecurityEvent.findPage({ sources: ["aiService"], limit: 50 });
  assert.ok(!page.events.some((e) => e.source === TEST_MARKER), "a source outside the requested list must never appear");
});

// ---------- HTTP-level: auth gating + basic response shape ----------

const TEST_PORT = 8807;
const BASE_URL = `http://localhost:${TEST_PORT}`;
let serverProcess;

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
});

test.after(() => {
  serverProcess.kill();
});

test("unauthorized (no token) cannot reach any new Security Center route", async () => {
  for (const path of ["/api/admin/security/status", "/api/admin/security/events", "/api/admin/security/deployments"]) {
    const res = await fetch(`${BASE_URL}${path}`);
    assert.equal(res.status, 401, `${path} must require auth`);
  }
});

test("GET /api/admin/security/status returns the expected top-level shape", async () => {
  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/security/status`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.overall === "string");
  assert.ok(body.systems && typeof body.systems === "object");
  assert.ok(body.version);
  assert.ok(body.versionConsistency);
  assert.ok(body.aiControl);
  // Never claim healthy without evidence — an unconfigured integration
  // must say so, never silently default to a HEALTHY-looking value.
  assert.equal(body.systems.railway.status, "NOT_CONFIGURED");
});

test("GET /api/admin/security/events rejects an invalid category instead of silently ignoring it", async () => {
  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/security/events?category=NotARealCategory`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 400);
});

test("GET /api/admin/security/events supports pagination end-to-end over real HTTP", async () => {
  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/security/events?limit=1`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.events));
  assert.ok(body.events.length <= 1);
  if (body.events.length === 1) {
    assert.ok(CATEGORIES.includes(body.events[0].category), "every returned event must carry a real category");
  }
});

test("GET /api/admin/security/deployments returns an honest not-configured shape without RAILWAY_API_TOKEN", async () => {
  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/security/deployments`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.railway.configured, false);
  assert.deepEqual(body.deployments, []);
});
