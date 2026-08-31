const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
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

app.use(cors());
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

function contentTypeFor(reqPath) {
  if (reqPath.endsWith(".xml")) return "application/xml";
  if (reqPath.endsWith(".txt")) return "text/plain";
  return "text/html";
}

app.get(["/", /\.(html|xml|txt)$/], (req, res, next) => {
  const reqPath = req.path === "/" ? "/index.html" : req.path;
  if (!TEMPLATED_FILE.test(reqPath)) return next();

  const filePath = path.join(FRONTEND_DIR, reqPath);
  fs.readFile(filePath, "utf8", (err, contents) => {
    if (err) return next();
    if (env.siteUrl !== RAILWAY_DEFAULT_SITE_URL) {
      contents = contents.split(RAILWAY_DEFAULT_SITE_URL).join(env.siteUrl);
    }
    res.type(contentTypeFor(reqPath)).send(contents);
  });
});

// Serve the static frontend from the same origin — no CORS juggling needed
// between the site and its own API.
app.use(express.static(FRONTEND_DIR));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
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
