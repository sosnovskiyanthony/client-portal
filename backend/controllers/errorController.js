// Frontend error monitoring's server-side sink (see frontend/js/errorMonitor.js).
// Deliberately reuses the existing Sentry pipe (already wired in server.js's
// global error handler / uncaughtException / unhandledRejection) rather
// than adding a second log store or the Sentry browser SDK — see
// guardian/rules.js and guardian/README.md for why.
const Sentry = require("@sentry/node");

const MAX_STRING_CHARS = 2000;
const MAX_STACK_CHARS = 4000;

function truncate(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) + "…[truncated]" : value;
}

// Client-supplied error metadata is untrusted input, not a security
// signal — a browser can report any message/stack/url it wants, honest or
// not. This only ever sanitizes/truncates and forwards to Sentry as
// diagnostic context; it never drives an authorization or security
// decision. Deliberately allowlisted fields only — never accepts or logs
// form contents, request bodies, or anything else a page might otherwise
// have on hand.
function reportClientError(req, res) {
  const body = req.body || {};
  const message = truncate(String(body.message || "Unknown client error"), MAX_STRING_CHARS);
  const stack = truncate(typeof body.stack === "string" ? body.stack : "", MAX_STACK_CHARS);
  const url = truncate(typeof body.url === "string" ? body.url : "", MAX_STRING_CHARS);
  const userAgent = truncate(req.headers["user-agent"] || "", MAX_STRING_CHARS);
  const line = Number.isInteger(body.line) ? body.line : null;
  const col = Number.isInteger(body.col) ? body.col : null;

  const err = new Error(message);
  if (stack) err.stack = stack;

  Sentry.captureException(err, {
    tags: { source: "frontend" },
    extra: { url, line, col, userAgent },
  });

  // 202: accepted for reporting purposes, not a resource that was created —
  // the client doesn't need (and shouldn't get) any detail back.
  res.status(202).json({ received: true });
}

module.exports = { reportClientError };
