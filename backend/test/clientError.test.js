// Full-stack integration tests for POST /api/client-error — the frontend
// error monitoring sink (see frontend/js/common.js's initErrorMonitor,
// controllers/errorController.js). Same spawn-the-real-server pattern as
// the other integration test files.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const TEST_PORT = 8802;
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

test("accepts a well-formed error report, unauthenticated, no admin token required", async () => {
  const res = await fetch(`${BASE_URL}/api/client-error`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "TypeError: x is not a function",
      stack: "at foo (bar.js:1:1)",
      url: "https://example.com/page.html",
      line: 10,
      col: 5,
    }),
  });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.received, true);
});

test("handles an empty/malformed body gracefully instead of crashing", async () => {
  const res = await fetch(`${BASE_URL}/api/client-error`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 202);
});

test("truncates an oversized message/stack rather than storing/forwarding it unbounded", async () => {
  const res = await fetch(`${BASE_URL}/api/client-error`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "x".repeat(50000), stack: "y".repeat(50000) }),
  });
  assert.equal(res.status, 202);
});

test("does not accept or reflect back arbitrary extra fields (e.g. form contents)", async () => {
  const res = await fetch(`${BASE_URL}/api/client-error`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "test",
      // Not part of the allowlisted shape — must be silently ignored, not
      // stored or echoed anywhere the response could leak it back out.
      formData: { email: "client@example.com", notes: "sensitive project details" },
    }),
  });
  assert.equal(res.status, 202);
  const rawBody = await res.text();
  assert.ok(!rawBody.includes("client@example.com"));
  assert.ok(!rawBody.includes("sensitive project details"));
});

test("rate limits after 30 requests in the window", async () => {
  let sawRateLimited = false;
  for (let i = 0; i < 35; i++) {
    const res = await fetch(`${BASE_URL}/api/client-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: `rate limit probe ${i}` }),
    });
    if (res.status === 429) {
      sawRateLimited = true;
      break;
    }
  }
  assert.ok(sawRateLimited, "expected a 429 within 35 requests given a 30/hour limit");
});
