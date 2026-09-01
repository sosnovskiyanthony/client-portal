// Must be required before any other module in this app — this is Sentry's
// own documented requirement: Sentry.init() has to run before Express/pg/etc.
// are required for its auto-instrumentation of those modules to work at all.
// See server.js's first line.
//
// Dormant unless SENTRY_DSN is set — same "optional third-party integration"
// pattern as ai/providers/anthropicProvider.js and services/storage.js. When
// it's not set, Sentry.captureException() calls elsewhere in the app (see
// server.js's error handler) are safe no-ops — the SDK is designed for that,
// confirmed directly against the installed version rather than assumed.
require("dotenv").config();

if (process.env.SENTRY_DSN) {
  const Sentry = require("@sentry/node");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
  });
}
