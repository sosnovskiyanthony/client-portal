// Sentry privacy hardening — see guardian/README.md's "Sentry privacy
// review" section. instrument.js's Sentry.init() had no `beforeSend` hook
// at all before this: the three raw `Sentry.captureException(err)` call
// sites in server.js (the global error handler, uncaughtException,
// unhandledRejection) forward whatever the caught error's own
// message/stack happens to contain, with zero scrubbing — if a thrown
// error's message ever embedded a token or secret (e.g. a low-level HTTP
// client error that echoes back a request header), it would reach Sentry
// verbatim. controllers/errorController.js's frontend-error path already
// only forwards an explicit allowlist of fields (safe by construction, not
// by scrubbing) — this hook is what closes the gap for every OTHER
// captureException call in the app, present and future, in one place
// instead of auditing every call site by hand.
//
// Regex-based, conservative, and pattern-based — this is a tripwire against
// obviously secret-shaped substrings ending up in event text, not a
// guarantee nothing sensitive can ever appear in an error message. Applied
// to plain strings only; never attempts to parse/understand structured data.
"use strict";

const REDACTED = "[REDACTED]";

// Order matters: JWT_PATTERN must run before BEARER_PATTERN would otherwise
// leave the raw JWT behind after stripping just the "Bearer " prefix — but
// since BEARER_PATTERN captures greedily through the token, order here
// doesn't actually matter in practice; kept explicit for clarity anyway.
const PATTERNS = [
  // "Bearer <anything-non-whitespace>" — covers Authorization header values
  // and any error message that happens to echo one back.
  { name: "bearer_token", re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  // A JWT's own three-dot-separated base64url shape (header.payload.sig) —
  // this app's own admin tokens, and Supabase's service-role key, are both
  // shaped like this.
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  // Known provider key prefixes used by this app's actual integrations
  // (config/env.js) — Resend, Anthropic, Tavily, and a generic "sk-" catch-
  // all for other common API-key conventions.
  { name: "resend_key", re: /\bre_[A-Za-z0-9_-]{10,}\b/g },
  { name: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g },
  { name: "tavily_key", re: /\btvly-[A-Za-z0-9_-]{10,}\b/g },
  { name: "generic_sk_key", re: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  // A Postgres connection string with embedded credentials.
  { name: "postgres_url", re: /postgres(?:ql)?:\/\/[^\s@]+@[^\s]+/gi },
  // Supabase Storage signed URLs carry a time-limited access token in the
  // query string — scrub the whole query string, not just a keyword match.
  { name: "supabase_signed_url_token", re: /([?&]token=)[^&\s]+/gi, replacement: "$1" + REDACTED },
];

function scrubString(value) {
  if (typeof value !== "string" || !value) return value;
  let result = value;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern.re, pattern.replacement || REDACTED);
  }
  return result;
}

function scrubExceptionValues(values) {
  if (!Array.isArray(values)) return values;
  return values.map((v) => ({
    ...v,
    value: scrubString(v?.value),
  }));
}

function scrubBreadcrumbs(breadcrumbs) {
  if (!Array.isArray(breadcrumbs)) return breadcrumbs;
  return breadcrumbs.map((b) => ({
    ...b,
    message: scrubString(b?.message),
  }));
}

function scrubExtra(extra) {
  if (!extra || typeof extra !== "object") return extra;
  const scrubbed = {};
  for (const [key, value] of Object.entries(extra)) {
    scrubbed[key] = typeof value === "string" ? scrubString(value) : value;
  }
  return scrubbed;
}

// The actual `beforeSend` hook — every field it touches is optional/
// defensively-checked, since not every event shape populates all of them.
function scrubEvent(event) {
  if (!event || typeof event !== "object") return event;

  if (typeof event.message === "string") {
    event.message = scrubString(event.message);
  }
  if (event.exception?.values) {
    event.exception.values = scrubExceptionValues(event.exception.values);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = scrubBreadcrumbs(event.breadcrumbs);
  }
  if (event.extra) {
    event.extra = scrubExtra(event.extra);
  }
  // Authorization/cookie headers, if Sentry's own request-data capture
  // ever populates them (this app doesn't opt into that, but a future
  // integration change might) — dropped entirely rather than scrubbed,
  // since the header name alone already signals "this held a credential."
  if (event.request?.headers) {
    delete event.request.headers.authorization;
    delete event.request.headers.Authorization;
    delete event.request.headers.cookie;
    delete event.request.headers.Cookie;
  }

  return event;
}

module.exports = { scrubEvent, scrubString, REDACTED };
