// Full-stack integration tests for GET /api/admin/guardian/diagnostics —
// same pattern as test/servicesIntake.test.js: spawns the real server
// against real local Postgres, exercises it over real HTTP.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const TEST_PORT = 8800;
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

test("401 without a token", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/diagnostics`);
  assert.equal(res.status, 401);
});

test("401 with a malformed/invalid token", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/guardian/diagnostics`, {
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  assert.equal(res.status, 401);
});

test("returns a well-shaped diagnostics object with a real admin token", async () => {
  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/guardian/diagnostics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();

  for (const key of ["database", "storage", "ollama", "resend", "tavily", "overall"]) {
    assert.ok(key in body, `expected "${key}" in the diagnostics response`);
  }
  assert.ok(["HEALTHY", "WARNING", "FAILED"].includes(body.overall));
  for (const dep of ["database", "storage", "ollama", "resend", "tavily"]) {
    assert.ok("configured" in body[dep] && "status" in body[dep]);
  }
  // Database is a real, mandatory dependency the test server is actually
  // connected to — should read HEALTHY, not merely "present."
  assert.equal(body.database.status, "HEALTHY");
});

test("no secret values ever appear in the diagnostics response body", async () => {
  const token = await adminToken();
  const res = await fetch(`${BASE_URL}/api/admin/guardian/diagnostics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rawBody = await res.text();

  const secrets = [
    process.env.JWT_SECRET,
    process.env.ADMIN_PASSWORD,
    process.env.DATABASE_URL,
    process.env.TAVILY_API_KEY,
    process.env.RESEND_API_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.OLLAMA_CONTROL_SECRET,
  ].filter((v) => typeof v === "string" && v.length > 0);

  for (const secret of secrets) {
    assert.ok(!rawBody.includes(secret), `response body must never contain the raw value of a configured secret`);
  }
});
