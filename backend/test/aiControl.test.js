// Direct tests for guardian/aiControl.js against the real local test
// database — the actual DB-backed read/write path (mocked instead in
// test/circuitBreaker.test.js, which tests circuitBreaker.js's own
// threshold logic without needing real state changes — see that file's
// header comment for why).
const test = require("node:test");
const assert = require("node:assert/strict");
const { pool } = require("../config/database");
const aiControl = require("../guardian/aiControl");
const { AiAnalysisError } = require("../ai/errors");

async function resetControlState() {
  await pool.query("DELETE FROM security_events");
  await pool.query("DELETE FROM ai_control_state WHERE id > 1");
  await pool.query("UPDATE ai_control_state SET state = 'ENABLED', reason = 'test reset', source = 'system' WHERE id = 1");
}

// Both before AND after every test — this file writes real DISABLED/
// LOCKDOWN state to the shared local test database (that's the whole
// point: it's the direct-DB-path test, as opposed to
// test/circuitBreaker.test.js which mocks the DB boundary specifically to
// avoid this). node:test runs different test FILES concurrently by
// default, all against the same Postgres, so leaving non-ENABLED state in
// place for even the rest of this file's own run window risks a
// concurrently-running file's real aiService call failing for an
// unrelated reason. See git history around test/circuitBreaker.test.js for
// the exact flake this pattern fixes.
test.beforeEach(resetControlState);
test.afterEach(resetControlState);
test.after(async () => {
  await pool.end();
});

test("getAiState reflects the real seeded ENABLED state", async () => {
  const state = await aiControl.getAiState();
  assert.equal(state.state, "ENABLED");
});

test("assertAiAllowed does not throw while ENABLED", async () => {
  await aiControl.assertAiAllowed("testOp");
});

test("setAiState(DISABLED) persists and assertAiAllowed then throws ai_disabled", async () => {
  await aiControl.setAiState({ state: "DISABLED", reason: "test", source: "admin" });
  const state = await aiControl.getAiState();
  assert.equal(state.state, "DISABLED");

  await assert.rejects(
    () => aiControl.assertAiAllowed("testOp"),
    (err) => err instanceof AiAnalysisError && err.code === "ai_disabled"
  );
});

test("setAiState(LOCKDOWN) persists and assertAiAllowed then throws ai_lockdown", async () => {
  await aiControl.setAiState({ state: "LOCKDOWN", reason: "test", source: "admin" });
  await assert.rejects(
    () => aiControl.assertAiAllowed("testOp"),
    (err) => err instanceof AiAnalysisError && err.code === "ai_lockdown"
  );
});

test("rejects an invalid state value", async () => {
  await assert.rejects(() => aiControl.setAiState({ state: "BOGUS", source: "admin" }));
});

test("every setAiState call writes a security_events row", async () => {
  await aiControl.setAiState({ state: "DISABLED", reason: "audit test", source: "admin" });
  const { rows } = await pool.query(
    `SELECT event_type, severity FROM security_events WHERE event_type = 'ai_state_changed_to_disabled' ORDER BY created_at DESC LIMIT 1`
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].severity, "WARNING");
});

test("LOCKDOWN transitions are logged at CRITICAL severity", async () => {
  await aiControl.setAiState({ state: "LOCKDOWN", reason: "audit test", source: "admin" });
  const { rows } = await pool.query(
    `SELECT severity FROM security_events WHERE event_type = 'ai_state_changed_to_lockdown' ORDER BY created_at DESC LIMIT 1`
  );
  assert.equal(rows[0].severity, "CRITICAL");
});

test("re-enabling is blocked while the latest CRITICAL event is unacknowledged", async () => {
  await aiControl.setAiState({ state: "LOCKDOWN", reason: "incident", source: "circuit_breaker" });
  await assert.rejects(
    () => aiControl.setAiState({ state: "ENABLED", reason: "trying to re-enable", source: "admin" }),
    (err) => err.code === "unacknowledged_critical_event"
  );
  const state = await aiControl.getAiState();
  assert.equal(state.state, "LOCKDOWN", "the failed enable attempt must not have changed the state");
});

test("re-enabling succeeds once the blocking CRITICAL event is acknowledged", async () => {
  const SecurityEvent = require("../models/SecurityEvent");
  await aiControl.setAiState({ state: "LOCKDOWN", reason: "incident", source: "circuit_breaker" });
  const latest = await SecurityEvent.findLatestBySeverity("CRITICAL");
  await SecurityEvent.acknowledge(latest.id, 1);

  const result = await aiControl.setAiState({ state: "ENABLED", reason: "resolved", source: "admin" });
  assert.equal(result.state, "ENABLED");
});

test("a stale, already-acknowledged CRITICAL event does not block a later re-enable", async () => {
  const SecurityEvent = require("../models/SecurityEvent");
  await aiControl.setAiState({ state: "LOCKDOWN", reason: "incident 1", source: "circuit_breaker" });
  const first = await SecurityEvent.findLatestBySeverity("CRITICAL");
  await SecurityEvent.acknowledge(first.id, 1);
  await aiControl.setAiState({ state: "ENABLED", reason: "resolved 1", source: "admin" });

  // No new CRITICAL event since — a plain disable/enable cycle must work
  // without needing to acknowledge anything new.
  await aiControl.setAiState({ state: "DISABLED", reason: "routine", source: "admin" });
  const result = await aiControl.setAiState({ state: "ENABLED", reason: "resolved 2", source: "admin" });
  assert.equal(result.state, "ENABLED");
});

test("BRINDLEAF_AI_ENABLED=false overrides an ENABLED database state", async () => {
  // config/env.js reads process.env exactly once, at module load — same
  // convention as every other field there (matches this app's real
  // behavior: changing this on Railway needs a redeploy/restart, see
  // config/env.js's own comment on aiEnabledOverride). Proving the
  // override actually wins therefore requires a genuinely fresh module
  // load with the env var already set beforehand, not just mutating
  // process.env against the already-cached module this file's own
  // top-level `aiControl` require loaded.
  const original = process.env.BRINDLEAF_AI_ENABLED;
  process.env.BRINDLEAF_AI_ENABLED = "false";
  delete require.cache[require.resolve("../config/env")];
  delete require.cache[require.resolve("../guardian/aiControl")];
  try {
    const freshAiControl = require("../guardian/aiControl");
    const state = await freshAiControl.getAiState();
    assert.equal(state.state, "DISABLED");
    assert.equal(state.source, "env_override");
  } finally {
    if (original === undefined) delete process.env.BRINDLEAF_AI_ENABLED;
    else process.env.BRINDLEAF_AI_ENABLED = original;
    // Restore both modules to their normal (env var unset) state for every
    // later test in this file/process.
    delete require.cache[require.resolve("../config/env")];
    delete require.cache[require.resolve("../guardian/aiControl")];
    require("../guardian/aiControl");
  }
});

test("fails closed when the control database is unreachable", async () => {
  const { Pool } = require("pg");
  const brokenPool = new Pool({ connectionString: "postgresql://localhost:5432/definitely_does_not_exist_db" });
  const originalQuery = pool.query.bind(pool);
  // Monkey-patch the SAME pool object aiControl.js requires (module cache
  // singleton) rather than swapping the whole module, so this test doesn't
  // need dependency injection support that doesn't exist elsewhere in the
  // app.
  pool.query = () => brokenPool.query("SELECT 1");
  try {
    const state = await aiControl.getAiState();
    assert.equal(state.state, "DISABLED");
    assert.match(state.reason, /unreachable/);
  } finally {
    pool.query = originalQuery;
    await brokenPool.end();
  }
});
