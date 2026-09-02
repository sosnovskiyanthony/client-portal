const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const User = require("../models/User");
const { EMAIL_RE } = require("../lib/validators");
const { logSecurityEvent } = require("../guardian/securityEvents");

// bcrypt.compareSync takes roughly the same time regardless of whether it
// matches. Comparing against this fixed hash when no user exists — instead
// of short-circuiting before ever calling compareSync — keeps a
// nonexistent-email login attempt from finishing measurably faster than a
// real one, which would otherwise let an attacker enumerate which emails
// are registered (there's only one admin account, so this directly protects
// whether a guessed address is it). Cost factor must match
// config/database.js's BCRYPT_COST, or this reopens the exact gap it closes.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

async function login(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email and password are required." });
  }

  const user = await User.findByEmail(email);
  const passwordMatches = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordMatches) {
    // Fire-and-forget, never awaited — logging a failed attempt must not
    // add any timing variance on top of the fixed-cost bcrypt comparison
    // above, or it would reopen exactly the enumeration side-channel
    // DUMMY_HASH exists to close. Never logs the attempted password.
    logSecurityEvent({
      severity: "WARNING",
      eventType: "auth_login_failed",
      actorType: "unauthenticated",
      source: "authController",
      description: "Failed admin login attempt.",
      metadata: { attemptedEmail: email },
    }).catch(() => {});
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, tokenVersion: user.token_version },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );

  logSecurityEvent({
    severity: "INFO",
    eventType: "auth_login_success",
    actorType: "admin",
    actorId: user.id,
    source: "authController",
    description: `Admin login: ${user.email}.`,
  }).catch(() => {});

  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
}

// Real server-side logout — bumps token_version so the JWT that was just
// used (and any other outstanding one, since there's only one admin
// account and no per-session granularity) is rejected by every future
// request. req.user is already verified by authenticate() before this
// runs, so req.user.sub is trustworthy.
async function logout(req, res) {
  await User.bumpTokenVersion(req.user.sub);

  logSecurityEvent({
    severity: "INFO",
    eventType: "auth_logout",
    actorType: "admin",
    actorId: req.user.sub,
    source: "authController",
    description: `Admin logout: ${req.user.email}.`,
  }).catch(() => {});

  res.status(204).end();
}

module.exports = { login, logout };
