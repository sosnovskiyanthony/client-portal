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

// Same reasoning as JWT_SECRET above: the fallback values here are printed
// in .env.example and README.md, so a silent fallback in production would
// mean anyone who's ever seen this repo can log into the live admin
// dashboard — which now holds every lead's PII plus uploaded files. Fail
// loud in production; only fall back (with a visible warning) for local dev.
let adminEmail = process.env.ADMIN_EMAIL;
let adminPassword = process.env.ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must both be set in production — refusing to start with an insecure default.");
  }
  console.warn("[env] ADMIN_EMAIL/ADMIN_PASSWORD not set — using an insecure default. This is only OK for local dev.");
  adminEmail = adminEmail || "admin@brindleaf.dev";
  adminPassword = adminPassword || "brindleaf-admin";
}

module.exports = {
  port: Number(process.env.PORT) || 8743,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  adminEmail: adminEmail.toLowerCase(),
  adminPassword,

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
  //
  // Opt-in by default (empty, not a real ID): a hardcoded fallback here
  // would mean a deployment that forgets to set this env var silently
  // starts reporting its real traffic to whatever GA property that fallback
  // ID belongs to — someone else's, in a template/demo repo. GA also only
  // ever actually loads after the visitor accepts the consent banner (see
  // frontend/js/analytics.js) regardless of whether this is set.
  gaMeasurementId: process.env.GA_MEASUREMENT_ID || "",

  // AI project analysis (see ai/aiService.js). "ollama" is the default —
  // free, local inference, no API key, $0 per request. "anthropic" is built
  // and available but dormant: it only runs if explicitly selected here AND
  // ANTHROPIC_API_KEY is set, so switching providers is a config change, not
  // a code change.
  aiProvider: process.env.AI_PROVIDER || "ollama",

  // Ollama server location — defaults to the same machine. In production
  // this must point at a private, non-public Ollama instance (see
  // ai/README.md) — never a publicly reachable one, since Ollama's API has
  // no built-in authentication.
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, ""),
  ollamaModel: process.env.OLLAMA_MODEL || "qwen2.5:7b",

  // Only used when aiProvider === "anthropic".
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  aiModel: process.env.AI_MODEL || "claude-opus-5",

  // Backs the AI chat feature's manual "Research this" action (see
  // services/webSearch.js, ai/researchTool.js). Optional — the feature is
  // simply unavailable (hidden in the UI, 400 if called directly) when
  // unset, same "dormant by default" pattern as anthropicApiKey. Only ever
  // paired with the Ollama provider — see ai/aiService.js's
  // chatReplyWithResearch for why this doesn't apply when
  // AI_PROVIDER=anthropic.
  tavilyApiKey: process.env.TAVILY_API_KEY || null,

  // Brand-asset file uploads on the web-design intake form (see
  // services/storage.js). Optional — when either is unset, upload/view
  // endpoints respond with a clear 503 instead of the app failing to start.
  // The service role key must never reach the frontend; it's only ever read
  // server-side here. Use Project Settings → API in the Supabase dashboard
  // for both, and create the bucket (private, name matches SUPABASE_BUCKET)
  // under Storage.
  supabaseUrl: process.env.SUPABASE_URL || null,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  supabaseBucket: process.env.SUPABASE_BUCKET || "brand-assets",

  // Separate private bucket for generated contract PDFs (see
  // services/contractPdf.js, controllers/contractController.js) — reuses
  // the same SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY above, just a
  // different bucket, so contract documents and client brand-asset
  // uploads never share storage. Same "unconfigured = clear 503" pattern.
  supabaseContractsBucket: process.env.SUPABASE_CONTRACTS_BUCKET || "contracts",

  // Lets an admin start/stop Ollama remotely from the dashboard — talks to
  // a small always-on control helper running on whichever machine hosts
  // Ollama (see ai/README.md's "Remote Ollama control" section), over the
  // same Tailscale connection used for AI analysis itself. Optional — the
  // toggle just shows "not configured" until both are set.
  ollamaControlUrl: process.env.OLLAMA_CONTROL_URL || null,
  ollamaControlSecret: process.env.OLLAMA_CONTROL_SECRET || null,

  // Guardian's AI safety control plane (see guardian/aiControl.js) —
  // an infrastructure-level emergency override for disabling every AI
  // feature without needing the website to be reachable at all. Checked
  // BEFORE the database-backed ai_control_state, and wins unconditionally
  // when set to the literal string "false": no DB state can re-enable AI
  // while this is set. Unset (the default) means "defer to the database."
  // Only ever read once at boot (like every other env var here), so
  // changing it on Railway requires a redeploy/restart to take effect —
  // documented in guardian/README.md as the tradeoff against the faster,
  // no-redeploy `guardian/setAiState.js` CLI method.
  aiEnabledOverride: process.env.BRINDLEAF_AI_ENABLED || null,

  // Off by default — see guardian/integrityCheck.js and server.js's start().
  // A boot-time hash check of security-critical files against the committed
  // manifest; a mismatch logs a CRITICAL security event and locks down AI.
  // Deliberately opt-in rather than always-on: enabling it changes what a
  // normal deploy does (it can now fail closed on a false-positive manifest
  // drift, e.g. a legitimate hotfix that forgot to run
  // `npm run guardian:integrity:update`), so this is a decision for the
  // operator to make explicitly, not a default that could surprise an
  // existing deploy the moment this code ships.
  integrityCheckOnBoot: process.env.GUARDIAN_INTEGRITY_CHECK_ON_BOOT === "true",
};
