const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const User = require("../models/User");
const { EMAIL_RE } = require("../lib/validators");

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
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const token = jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );

  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
}

module.exports = { login };
