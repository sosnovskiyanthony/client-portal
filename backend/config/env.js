require("dotenv").config();

// A silent fallback here would mean: if JWT_SECRET ever went unset in
// production (a Railway config mistake, a wiped env var), the app would
// start up fine and just sign every admin token with a fixed string that's
// sitting in plaintext in this file — anyone who's ever read this repo could
// forge a valid admin JWT. Fail loudly in production; only fall back (with a
// visible warning) for local dev, where no real submissions data is at risk.
const INSECURE_JWT_FALLBACK = "dev-only-insecure-secret-change-me";
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production — refusing to start with an insecure default.");
  }
  console.warn("[env] JWT_SECRET not set — using an insecure default. This is only OK for local dev.");
  jwtSecret = INSECURE_JWT_FALLBACK;
}

module.exports = {
  port: Number(process.env.PORT) || 8743,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  adminEmail: (process.env.ADMIN_EMAIL || "admin@studio.dev").toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || "studio-admin",

  // Postgres connection string. Get this from Supabase: Project Settings →
  // Database → Connection string (use the "Session pooler" or direct URI).
  // Falls back to a local Postgres for development.
  databaseUrl: process.env.DATABASE_URL || "postgresql://localhost:5432/client_portal_dev",

  // Email notifications (optional) — sent via Resend when a new submission
  // comes in. Leave RESEND_API_KEY unset to disable notifications entirely;
  // submissions still save normally either way.
  resendApiKey: process.env.RESEND_API_KEY || null,
  notifyEmail: process.env.NOTIFY_EMAIL || null,
  notifyFromEmail: process.env.NOTIFY_FROM_EMAIL || "onboarding@resend.dev",

  // Canonical production URL, no trailing slash. Every canonical link,
  // Open Graph tag, JSON-LD url, and the sitemap/robots.txt Sitemap line in
  // the frontend HTML is hardcoded to RAILWAY_DEFAULT_SITE_URL (see
  // server.js). When a real custom domain exists, set SITE_URL here and
  // server.js rewrites every occurrence at serve time — no HTML file edits
  // needed. Until then this defaults to the same Railway URL already baked
  // into the HTML, so it's a no-op.
  siteUrl: (process.env.SITE_URL || "https://client-portal-production-d328.up.railway.app").replace(/\/$/, ""),

  // Google Analytics 4 Measurement ID. Injected server-side into every
  // public page (see server.js) via a single <!-- GA_TAG --> placeholder —
  // not hardcoded per file — so it can be swapped or unset from one place.
  // Deliberately left off admin.html (no reason to track the owner's own
  // dashboard visits).
  gaMeasurementId: process.env.GA_MEASUREMENT_ID || "G-GZ4Y4JKWLR",
};
