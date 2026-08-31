const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const User = require("../models/User");
const { EMAIL_RE } = require("../lib/validators");

async function login(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email and password are required." });
  }

  const user = await User.findByEmail(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
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
