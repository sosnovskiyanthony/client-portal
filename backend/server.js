// Must be the very first require in the app — see instrument.js.
require("./instrument");

const path = require("path");
const fs = require("fs");
const express = require("express");
const Sentry = require("@sentry/node");
const env = require("./config/env");
const { init, pool } = require("./config/database");

const authRoutes = require("./routes/auth");
const intakeRoutes = require("./routes/intake");
const contactRoutes = require("./routes/contact");
const adminRoutes = require("./routes/admin");
const contractRoutes = require("./routes/contracts");
const errorRoutes = require("./routes/errors");

const app = express();

// Railway (and most hosts) run the app behind one reverse proxy that sets
// X-Forwarded-For to the real client IP. Trusting exactly one hop lets
// express-rate-limit (and req.ip generally) use that IP safely, without
// blindly trusting the whole header chain.
app.set("trust proxy", 1);

// Stop leaking the framework in every response header.
app.disable("x-powered-by");

// No CORS middleware: the frontend and API are served from this exact same
// Express app on the same origin, so no cross-origin access is legitimate.
// A wildcard cors() here previously let any external site's JS call
// /api/auth/login (and every other endpoint) cross-origin for no reason —
// removing it restores the browser's default same-origin restriction.

// No 'unsafe-inline' anywhere — every page in frontend/ loads CSS/JS from
// real files (no inline <script>/<style>, no onclick= attributes), so this
// doesn't need the escape hatches most CSPs end up needing. The GA snippet
// specifically was rewritten (see renderGaSnippet() below and
// frontend/js/analytics.js) from an inline <script> to a dynamically-created
// one precisely so this could stay strict. The JWT lives in localStorage
// (see frontend/js/common.js), not an httpOnly cookie, so this is real
// defense against a same-origin XSS turning into full session theft, not
// just a hardening checkbox.
const CSP =
  "default-src 'self'; " +
  "script-src 'self' https://www.googletagmanager.com; " +
  "style-src 'self' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data:; " +
  "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  "frame-ancestors 'none'";

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", CSP);
  // No-op over plain HTTP (local dev); takes effect once served over HTTPS.
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
});

// One canonical URL per page: a trailing slash on any non-root path (e.g.
// /web-design/, or even /api/foo/) redirects to the slash-less form rather
// than silently serving both as separate 200s (or, for the clean-URL
// marketing routes below, 500ing — Express's default non-strict routing
// matches /web-design/ against the /web-design route but leaves req.path
// as "/web-design/", which doesn't equal any CLEAN_URL_PAGES entry).
app.use((req, res, next) => {
  if (req.path !== "/" && req.path.endsWith("/")) {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    return res.redirect(301, req.path.slice(0, -1) + qs);
  }
  next();
});

app.use(express.json());

// Unauthenticated, unrated — this is what an external uptime monitor
// (UptimeRobot, Better Uptime, Railway's own health checks, etc.) hits
// repeatedly and needs to always be reachable. Pings the DB rather than
// just returning a static 200, since "the process is up but the database
// connection is dead" is exactly the failure mode a monitor needs to catch
// — the app would otherwise look "healthy" while every real request 500s.
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({ status: "ok", database: "connected" });
  } catch (err) {
    console.error("[health] Database check failed:", err.message);
    res.status(503).json({ status: "error", database: "unreachable" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/intake", intakeRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin", adminRoutes);
// A second, separate router at the same prefix — routes/admin.js itself is
// untouched. Same authorization gate (authenticate + requireAdmin, applied
// inside routes/contracts.js), different concern.
app.use("/api/admin", contractRoutes);
app.use("/api/client-error", errorRoutes);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found." });
  }
  next();
});

// The frontend's HTML/XML/TXT files have the production domain hardcoded as
// their canonical/OG/JSON-LD/sitemap domain. Rather than templating tokens
// into the markup, we rewrite that literal string to env.siteUrl at serve
// time — so pointing SITE_URL at a different domain (a staging deploy, a
// future domain change) updates every page at once with zero file edits.
// A no-op today in production, since the default now matches the real,
// live custom domain (see config/env.js's siteUrl default).
const DEFAULT_BAKED_IN_SITE_URL = "https://brindleaf.com";
const TEMPLATED_FILE = /\.(html|xml|txt)$/;
const FRONTEND_DIR = path.join(__dirname, "frontend");
const GA_TAG_PLACEHOLDER = "<!-- GA_TAG -->";

function contentTypeFor(reqPath) {
  if (reqPath.endsWith(".xml")) return "application/xml";
  if (reqPath.endsWith(".txt")) return "text/plain";
  return "text/html";
}

// Emits a <meta> tag carrying the measurement ID, not an inline <script> —
// frontend/js/analytics.js reads it and only actually loads GA (dynamically,
// via document.createElement) after the visitor accepts the consent banner.
// This is also what keeps the site compatible with a strict
// script-src 'self' https://www.googletagmanager.com CSP with no
// 'unsafe-inline' exception (see the Content-Security-Policy header below).
function renderGaSnippet() {
  if (!env.gaMeasurementId) return "";
  const id = env.gaMeasurementId.replace(/"/g, "&quot;");
  return `<meta name="ga-measurement-id" content="${id}" />`;
}

function templateFileContents(contents) {
  if (env.siteUrl !== DEFAULT_BAKED_IN_SITE_URL) {
    contents = contents.split(DEFAULT_BAKED_IN_SITE_URL).join(env.siteUrl);
  }
  if (contents.includes(GA_TAG_PLACEHOLDER)) {
    contents = contents.split(GA_TAG_PLACEHOLDER).join(renderGaSnippet());
  }
  return contents;
}

// Confines a request path to FRONTEND_DIR before any filesystem read.
// Express's router already normalizes "../" segments out of req.path before
// a route like this ever matches, but that's an implementation detail of
// path-to-regexp, not a documented security guarantee — don't build a
// traversal boundary on top of framework behavior that could change under
// us. Returns null if the resolved path would escape FRONTEND_DIR.
function resolveFrontendPath(reqPath) {
  const filePath = path.join(FRONTEND_DIR, reqPath);
  return filePath.startsWith(FRONTEND_DIR + path.sep) ? filePath : null;
}

// Single source of truth for every indexable marketing page's clean,
// extensionless URL — drives the clean-URL routes below, the legacy .html
// -> clean 301 redirects, and sitemap.xml generation, so none of those
// three can silently drift out of sync with each other the way the old
// static sitemap.xml did (it was missing 3 real pages before this change).
//
// web-design.html and services.html are deliberately NOT here — both are
// noindex,nofollow intake/routing utility pages (see their own <meta
// name="robots"> tags), not indexable marketing content, so they keep
// their existing .html URLs rather than getting a clean slug. This also
// avoids a collision: the marketing page users actually mean by "the web
// design page" is web-design-services.html (its title/content match), so
// that's what gets the short /web-design slug — the intake form stays at
// /web-design.html, still a normal, stable, crawlable-if-it-mattered GET
// URL, just not one this app is asking search engines to index.
const CLEAN_URL_PAGES = [
  { path: "/web-design", file: "web-design-services.html", priority: "0.9", lastmod: "2026-09-03" },
  { path: "/seo", file: "seo.html", priority: "0.9", lastmod: "2026-09-03" },
  { path: "/ai-integration", file: "ai-integration.html", priority: "0.9", lastmod: "2026-09-03" },
  { path: "/app-building", file: "app-building.html", priority: "0.9", lastmod: "2026-09-03" },
  { path: "/web-management", file: "web-management.html", priority: "0.9", lastmod: "2026-09-03" },
  { path: "/contact", file: "contact.html", priority: "0.7", lastmod: "2026-09-03" },
];

// Old .html URL -> new clean URL, one 301 hop each (never a chain). Includes
// /index.html -> / — before this, /index.html served the same content as /
// with no redirect, a soft duplicate only mitigated by its canonical tag.
const LEGACY_REDIRECTS = new Map([
  ["/index.html", "/"],
  ...CLEAN_URL_PAGES.map((p) => [`/${p.file}`, p.path]),
]);

app.get([...LEGACY_REDIRECTS.keys()], (req, res) => {
  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(301, LEGACY_REDIRECTS.get(req.path) + qs);
});

app.get(
  CLEAN_URL_PAGES.map((p) => p.path),
  (req, res, next) => {
    const page = CLEAN_URL_PAGES.find((p) => p.path === req.path);
    const filePath = resolveFrontendPath(`/${page.file}`);
    if (!filePath) return next();
    fs.readFile(filePath, "utf8", (err, contents) => {
      if (err) return next();
      res.type("text/html").send(templateFileContents(contents));
    });
  }
);

// Generated from CLEAN_URL_PAGES (+ the homepage) rather than a static
// frontend/sitemap.xml file, for the same drift-prevention reason: a new
// marketing page now can't be added to the routes without also landing in
// the sitemap, because they're the same list.
function generateSitemapXml() {
  const pages = [{ path: "/", priority: "1.0", lastmod: "2026-09-03" }, ...CLEAN_URL_PAGES];
  const urls = pages
    .map(
      (p) => `  <url>
    <loc>${env.siteUrl}${p.path}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>${p.priority}</priority>
  </url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send(generateSitemapXml());
});

app.get(["/", /\.(html|xml|txt)$/], (req, res, next) => {
  const reqPath = req.path === "/" ? "/index.html" : req.path;
  if (!TEMPLATED_FILE.test(reqPath)) return next();

  const filePath = resolveFrontendPath(reqPath);
  if (!filePath) {
    return res.status(400).json({ error: "Invalid path." });
  }

  fs.readFile(filePath, "utf8", (err, contents) => {
    if (err) return next();
    res.type(contentTypeFor(reqPath)).send(templateFileContents(contents));
  });
});

// Serve the static frontend from the same origin — no CORS juggling needed
// between the site and its own API.
app.use(express.static(FRONTEND_DIR));

// Nothing above matched: not an API route (already handled), not a real
// templated file, not a static asset. A genuinely unknown URL — serve a
// real, on-brand 404 page with an actual 404 status, instead of Express's
// bare unbranded default.
app.use((req, res) => {
  const filePath = resolveFrontendPath("/404.html");
  fs.readFile(filePath, "utf8", (err, contents) => {
    if (err) return res.status(404).type("text/plain").send("Not found.");
    res.status(404).type("text/html").send(templateFileContents(contents));
  });
});

app.use((err, req, res, next) => {
  // express.json() throws a SyntaxError tagged with a 4xx status for
  // malformed request bodies — that's bad input, not a server failure, and
  // shouldn't be reported (to the client or in logs) as one.
  const code = err.status || err.statusCode;
  const isClientError = Number.isInteger(code) && code >= 400 && code < 500;

  if (!isClientError) {
    console.error(err);
    // A safe no-op when SENTRY_DSN isn't set (see instrument.js) — never
    // throws, never blocks the response either way.
    Sentry.captureException(err);
    return res.status(500).json({ error: "Something went wrong." });
  }

  console.error(`[${code}] ${err.message}`);
  res.status(code).json({ error: "Invalid request." });
});

// Neither of these previously had any handler at all — an uncaught
// exception or unhandled rejection anywhere (including outside a request,
// e.g. in a fire-and-forget call like notifyNewSubmission) would otherwise
// only ever show up as a bare stack trace in Railway's logs, with nothing
// external to notice it happened. Reporting to Sentry is a safe no-op when
// SENTRY_DSN isn't set (see instrument.js).
//
// uncaughtException still exits — Node's own documented recommendation,
// since the process may be in an inconsistent state afterward; Railway
// restarts the container the same way it always would on a crash.
// unhandledRejection does not exit — many of these are recoverable
// (a single failed background call), and this app didn't crash on them
// before this handler existed either, so this only adds visibility, not a
// new crash path.
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  Sentry.captureException(err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

async function start() {
  // Runs schema migrations + seeds the admin user before accepting traffic.
  await init();

  // Opt-in (see config/env.js's integrityCheckOnBoot) — a mismatch here
  // means a security-critical file (the AI control plane, auth, rate
  // limiting) doesn't match what was actually committed and reviewed.
  // Never blocks boot itself (a false positive here must not take the
  // whole site down) — logs CRITICAL and locks AI down, the same response
  // as any other CRITICAL security event, and lets the rest of the app
  // (public pages, intake forms, admin dashboard) keep serving traffic.
  if (env.integrityCheckOnBoot) {
    const { checkIntegrity } = require("./guardian/integrityCheck");
    const { logSecurityEvent } = require("./guardian/securityEvents");
    const aiControl = require("./guardian/aiControl");
    const result = checkIntegrity();
    if (!result.ok) {
      console.error("[integrity] DRIFT DETECTED on boot:", result.drifted, result.missing, result.extra);
      await logSecurityEvent({
        severity: "CRITICAL",
        eventType: "integrity_check_failed",
        actorType: "system",
        source: "server_boot",
        description: `Boot-time integrity check found ${result.drifted.length} modified and ${result.missing.length} missing protected file(s).`,
        metadata: { drifted: result.drifted, missing: result.missing, extra: result.extra },
      });
      await aiControl.setAiState({
        state: "LOCKDOWN",
        reason: "Boot-time integrity check detected unexpected changes to security-critical files.",
        source: "integrity_check",
      });
    } else {
      console.log("[integrity] Boot-time check passed — all protected files match the committed manifest.");
    }
  }

  app.listen(env.port, () => {
    console.log(`Client portal running at http://localhost:${env.port}`);
    console.log(`Admin login: ${env.adminEmail} / (password from .env)`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
