const path = require("path");
const express = require("express");
const cors = require("cors");
const env = require("./config/env");
const { init } = require("./config/database");

const authRoutes = require("./routes/auth");
const intakeRoutes = require("./routes/intake");
const contactRoutes = require("./routes/contact");
const adminRoutes = require("./routes/admin");

const app = express();

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

// Serve the static frontend from the same origin — no CORS juggling needed
// between the site and its own API.
app.use(express.static(path.join(__dirname, "frontend")));

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
