// Maps security_events.source to one of the categories the Security
// Center's activity feed groups by: AI, Backend, Infrastructure. Browser is
// a distinct fourth category but is deliberately absent from this map — no
// security_events row is ever written for a browser-side error (see
// controllers/errorController.js: those go straight to Sentry with zero
// local persistence), so the activity feed sources Browser entries
// separately, from Sentry's API, once SENTRY_AUTH_TOKEN is configured (see
// guardian/sentryStatus.js) — never from this table.
//
// Built by enumerating every real logSecurityEvent() call site in this
// codebase (2026-09-03), not guessed:
//   authController.js        -> "authController"        (login/logout)
//   aiService.js              -> "aiService"              (schema validation failures)
//   ollamaProvider.js         -> "ollamaProvider"          (capability violations)
//   aiControl.js               -> "aiControl"               (state changes, blocked operations)
//   server.js (boot integrity) -> "server_boot"             (integrity check failures)
// Update this alongside any new logSecurityEvent() call site — an
// unmapped source falls back to "Backend" (visible somewhere rather than
// silently dropped) and logs a one-time warning so the drift is noticed
// instead of quietly misfiling events forever.

const CATEGORIES = ["AI", "Browser", "Backend", "Infrastructure"];

const SOURCE_CATEGORY = {
  aiService: "AI",
  ollamaProvider: "AI",
  aiControl: "AI",
  authController: "Backend",
  server_boot: "Infrastructure",
};

const warnedSources = new Set();

function categoryForSource(source) {
  const category = SOURCE_CATEGORY[source];
  if (category) return category;
  if (!warnedSources.has(source)) {
    warnedSources.add(source);
    console.warn(`[eventCategory] Unrecognized security_events source "${source}" — showing as Backend until guardian/eventCategory.js is updated.`);
  }
  return "Backend";
}

// Extension point for a future case where a single source's events split
// across categories by event_type (e.g. two different event_types from
// the same module belonging to different categories) — none exist today,
// every source above maps to exactly one category. Kept explicit rather
// than added later so categoryForEvent's shape doesn't need to change.
const EVENT_TYPE_OVERRIDE = {};

function categoryForEvent({ source, eventType }) {
  if (eventType && EVENT_TYPE_OVERRIDE[eventType]) return EVENT_TYPE_OVERRIDE[eventType];
  return categoryForSource(source);
}

// Translates a "show me only Infrastructure events" filter into the list
// of raw source values to match — see models/SecurityEvent.js's
// findPage, which turns this into a `source = ANY($1)` SQL clause.
function sourcesForCategory(category) {
  return Object.entries(SOURCE_CATEGORY)
    .filter(([, cat]) => cat === category)
    .map(([source]) => source);
}

module.exports = { CATEGORIES, categoryForEvent, categoryForSource, sourcesForCategory };
