require("dotenv").config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT) || 8743,
  jwtSecret: required("JWT_SECRET", "dev-only-insecure-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  adminEmail: (process.env.ADMIN_EMAIL || "admin@studio.dev").toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || "studio-admin",
  databaseFile: process.env.DATABASE_FILE || "./data/portal.db",

  // Email notifications (optional) — sent via Resend when a new submission
  // comes in. Leave RESEND_API_KEY unset to disable notifications entirely;
  // submissions still save normally either way.
  resendApiKey: process.env.RESEND_API_KEY || null,
  notifyEmail: process.env.NOTIFY_EMAIL || null,
  notifyFromEmail: process.env.NOTIFY_FROM_EMAIL || "onboarding@resend.dev",
};
