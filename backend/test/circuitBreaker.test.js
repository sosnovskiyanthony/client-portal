// Tests guardian/circuitBreaker.js's threshold/trip logic by mocking its
// two boundaries — SecurityEvent.countRecentByEventTypes (the input
// signal) and aiControl.getAiState/setAiState (the effect) — rather than
// writing real LOCKDOWN rows to the shared local test database. This is
// deliberate, not a shortcut: node:test runs different test FILES
// concurrently by default, all against the same local Postgres, so a real
// LOCKDOWN row written here would be visible to any other concurrently-
// running file's real aiService calls the instant it's committed,
// regardless of that file's own NODE_ENV — a genuine flake this session
// hit directly (see git history around this file if you're wondering why
// it doesn't just call the real DB-backed path). Mocking the boundary
// tests the real decision logic in guardian/circuitBreaker.js with zero
// shared-state risk. The real DB-backed write path (aiControl.setAiState
// itself) already has its own direct, real-DB coverage in
// test/aiControl.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const SecurityEvent = require("../models/SecurityEvent");
const aiControl = require("../guardian/aiControl");
const { checkCircuitBreaker, SCHEMA_FAILURE_THRESHOLD, CAPABILITY_VIOLATION_THRESHOLD } = require("../guardian/circuitBreaker");

function mockModule(obj, overrides) {
  const originals = {};
  for (const key of Object.keys(overrides)) {
    originals[key] = obj[key];
    obj[key] = overrides[key];
  }
  return () => {
    for (const key of Object.keys(originals)) {
      obj[key] = originals[key];
    }
  };
}

async function withRealNodeEnv(fn) {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production"; // anything other than "test" — see circuitBreaker.js's guard
  try {
    await fn();
  } finally {
    process.env.NODE_ENV = original;
  }
}

test("below threshold: schema failures do not trip the breaker", async () => {
  const setStateCalls = [];
  const restore = mockModule(SecurityEvent, {
    countRecentByEventTypes: async (types) => (types[0] === "ai_schema_validation_failed" ? SCHEMA_FAILURE_THRESHOLD - 1 : 0),
  });
  const restoreControl = mockModule(aiControl, {
    getAiState: async () => ({ state: "ENABLED" }),
    setAiState: async (args) => { setStateCalls.push(args); },
  });
  try {
    await withRealNodeEnv(() => checkCircuitBreaker());
    assert.equal(setStateCalls.length, 0);
  } finally {
    restore();
    restoreControl();
  }
});

test("at threshold: schema failures trip the breaker into LOCKDOWN", async () => {
  const setStateCalls = [];
  const restore = mockModule(SecurityEvent, { countRecentByEventTypes: async (types) => (types[0] === "ai_schema_validation_failed" ? SCHEMA_FAILURE_THRESHOLD : 0) });
  const restoreControl = mockModule(aiControl, {
    getAiState: async () => ({ state: "ENABLED" }),
    setAiState: async (args) => { setStateCalls.push(args); },
  });
  try {
    await withRealNodeEnv(() => checkCircuitBreaker());
    assert.equal(setStateCalls.length, 1);
    assert.equal(setStateCalls[0].state, "LOCKDOWN");
    assert.equal(setStateCalls[0].source, "circuit_breaker");
    assert.match(setStateCalls[0].reason, /schema validation failures/);
  } finally {
    restore();
    restoreControl();
  }
});

test("at threshold: capability violations trip the breaker (lower threshold than schema failures)", async () => {
  const setStateCalls = [];
  const restore = mockModule(SecurityEvent, {
    countRecentByEventTypes: async (types) => (types[0] === "ai_capability_violation" ? CAPABILITY_VIOLATION_THRESHOLD : 0),
  });
  const restoreControl = mockModule(aiControl, {
    getAiState: async () => ({ state: "ENABLED" }),
    setAiState: async (args) => { setStateCalls.push(args); },
  });
  try {
    await withRealNodeEnv(() => checkCircuitBreaker());
    assert.equal(setStateCalls.length, 1);
    assert.equal(setStateCalls[0].state, "LOCKDOWN");
    assert.match(setStateCalls[0].reason, /capability violations/);
  } finally {
    restore();
    restoreControl();
  }
});

test("does not re-trip once already in LOCKDOWN", async () => {
  const setStateCalls = [];
  const restore = mockModule(SecurityEvent, { countRecentByEventTypes: async () => SCHEMA_FAILURE_THRESHOLD * 2 });
  const restoreControl = mockModule(aiControl, {
    getAiState: async () => ({ state: "LOCKDOWN" }), // already tripped
    setAiState: async (args) => { setStateCalls.push(args); },
  });
  try {
    await withRealNodeEnv(() => checkCircuitBreaker());
    assert.equal(setStateCalls.length, 0, "must not call setAiState again while already LOCKDOWN");
  } finally {
    restore();
    restoreControl();
  }
});

test("ordinary provider-connectivity errors (Ollama downtime) never trip the breaker", async () => {
  // Simulates a large volume of a DIFFERENT event_type than the two real
  // triggers (ai_schema_validation_failed / ai_capability_violation) — the
  // mock always returns 0 for those two specifically, proving the breaker
  // only ever counts the triggers it's actually configured for.
  const setStateCalls = [];
  const restore = mockModule(SecurityEvent, { countRecentByEventTypes: async () => 0 });
  const restoreControl = mockModule(aiControl, {
    getAiState: async () => ({ state: "ENABLED" }),
    setAiState: async (args) => { setStateCalls.push(args); },
  });
  try {
    await withRealNodeEnv(() => checkCircuitBreaker());
    assert.equal(setStateCalls.length, 0);
  } finally {
    restore();
    restoreControl();
  }
});

test("the NODE_ENV=test guard actually suppresses tripping (proves the rest of the suite is protected)", async () => {
  // No withRealNodeEnv wrapper — runs under the real npm test NODE_ENV=test,
  // same as every other test file. Even a real threshold breach must not
  // call setAiState at all.
  const setStateCalls = [];
  const restore = mockModule(SecurityEvent, { countRecentByEventTypes: async () => SCHEMA_FAILURE_THRESHOLD * 10 });
  const restoreControl = mockModule(aiControl, {
    getAiState: async () => ({ state: "ENABLED" }),
    setAiState: async (args) => { setStateCalls.push(args); },
  });
  try {
    await checkCircuitBreaker();
    assert.equal(setStateCalls.length, 0, "circuit breaker must no-op entirely when NODE_ENV=test");
  } finally {
    restore();
    restoreControl();
  }
});
