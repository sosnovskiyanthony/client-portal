// Deterministic AI circuit breaker — never asks a model to decide whether
// another model is behaving dangerously. Every check here is a plain
// count-over-a-time-window query against security_events, compared to a
// fixed, documented threshold. See guardian/README.md's "Circuit breaker"
// section for the reasoning behind the specific numbers below.
//
// State is DB-derived (a query against security_events), not in-memory —
// survives a Railway restart, unlike an in-memory counter would.
const SecurityEvent = require("../models/SecurityEvent");
const aiControl = require("./aiControl");

// Conservative and intentionally asymmetric: a capability violation (the
// model asked to do something it was never allowed to do at all) is a more
// serious signal than a schema-validation failure (the model's output was
// just malformed — often just a bad day for a small local model), so it
// trips on fewer occurrences within the same window.
const SCHEMA_FAILURE_THRESHOLD = 5;
const CAPABILITY_VIOLATION_THRESHOLD = 3;
const WINDOW_MINUTES = 15;

const TRIGGERS = [
  { eventTypes: ["ai_schema_validation_failed"], threshold: SCHEMA_FAILURE_THRESHOLD, label: "schema validation failures" },
  { eventTypes: ["ai_capability_violation"], threshold: CAPABILITY_VIOLATION_THRESHOLD, label: "capability violations" },
];

// Deliberately NOT triggers: ordinary provider-connectivity error codes
// (ollama_unavailable, timeout, model_unavailable, network_error,
// research_unavailable, unknown_provider, unsupported_type, no_analysis).
// Ollama running on the owner's local machine, reachable from production
// only via Tailscale, is expected to be intermittently offline by design —
// that is not a security incident, and this circuit breaker must never
// treat it as one (see guardian/rules.js's no-ollama-hard-dependency rule).

// Called after logging a schema-validation-failure or capability-violation
// event (see ai/aiService.js and ai/providers/ollamaProvider.js). Cheap —
// a couple of indexed COUNT queries — and safe to call on every such event
// without needing its own scheduling/cron.
async function checkCircuitBreaker() {
  // The existing test suite deliberately triggers invalid_schema (and, once
  // capability-firewall tests exist, capability-violation) errors many
  // times across many files to prove the app rejects them correctly — that
  // is expected test behavior, not a real pattern of AI misbehavior, and
  // must never cascade into a real LOCKDOWN that then breaks every
  // unrelated test running afterward. package.json's "test" script sets
  // NODE_ENV=test for exactly this reason (same convention as env.js's own
  // NODE_ENV==="production" gate). The circuit breaker's actual
  // threshold/trip logic still has its own dedicated test — see
  // test/circuitBreaker.test.js — which exercises it directly, bypassing
  // this guard on purpose.
  if (process.env.NODE_ENV === "test") return;

  for (const trigger of TRIGGERS) {
    const count = await SecurityEvent.countRecentByEventTypes(trigger.eventTypes, WINDOW_MINUTES);
    if (count >= trigger.threshold) {
      const current = await aiControl.getAiState();
      if (current.state === "LOCKDOWN") return; // already tripped, don't re-log/re-trip
      await aiControl.setAiState({
        state: "LOCKDOWN",
        reason: `Circuit breaker: ${count} ${trigger.label} in the last ${WINDOW_MINUTES} minutes (threshold: ${trigger.threshold}).`,
        source: "circuit_breaker",
      });
      return;
    }
  }
}

module.exports = { checkCircuitBreaker, SCHEMA_FAILURE_THRESHOLD, CAPABILITY_VIOLATION_THRESHOLD, WINDOW_MINUTES };
