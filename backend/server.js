const path = require("path");
const fs = require("fs");
const express = require("express");
const env = require("./config/env");
const { init } = require("./config/database");

const authRoutes = require("./routes/auth");
const intakeRoutes = require("./routes/intake");
const contactRoutes = require("./routes/contact");
const adminRoutes = require("./routes/admin");

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

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // No-op over plain HTTP (local dev); takes effect once served over HTTPS.
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  next();
});

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/intake", intakeRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Not found." });
  }
  next();
});

// The frontend's HTML/XML/TXT files have the Railway URL hardcoded as their
// canonical/OG/JSON-LD/sitemap domain. Rather than templating tokens into
// the markup, we rewrite that literal string to env.siteUrl at serve time —
// so setting SITE_URL to a real domain later updates every page at once
// with zero file edits. A no-op today since the default matches the HTML.
const RAILWAY_DEFAULT_SITE_URL = "https://client-portal-production-d328.up.railway.app";
const TEMPLATED_FILE = /\.(html|xml|txt)$/;
const FRONTEND_DIR = path.join(__dirname, "frontend");
const GA_TAG_PLACEHOLDER = "<!-- GA_TAG -->";

function contentTypeFor(reqPath) {
  if (reqPath.endsWith(".xml")) return "application/xml";
  if (reqPath.endsWith(".txt")) return "text/plain";
  return "text/html";
}

function renderGaSnippet() {
  if (!env.gaMeasurementId) return "";
  const id = env.gaMeasurementId;
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${id}');
</script>`;
}

function templateFileContents(contents) {
  if (env.siteUrl !== RAILWAY_DEFAULT_SITE_URL) {
    contents = contents.split(RAILWAY_DEFAULT_SITE_URL).join(env.siteUrl);
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
    return res.status(500).json({ error: "Something went wrong." });
  }

  console.error(`[${code}] ${err.message}`);
  res.status(code).json({ error: "Invalid request." });
});

async function start() {
  // Runs schema migrations + seeds the admin user before accepting traffic.
  await init();

  app.listen(env.port, () => {
    console.log(`Client portal running at http://localhost:${env.port}`);
    console.log(`Admin login: ${env.adminEmail} / (password from .env)`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
