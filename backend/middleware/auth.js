const jwt = require("jsonwebtoken");
const env = require("../config/env");
const User = require("../models/User");

// async, but deliberately never registered via asyncHandler at its call
// sites (routes/admin.js, routes/contracts.js just do
// `router.use(authenticate, requireAdmin)`) — every path through this
// function calls next()/res.json() before its own promise settles, so
// there's nothing for Express to await and nothing that can reject
// unhandled. See asyncHandler.js's own comment for why that wrapper
// exists elsewhere; it isn't needed here because this function catches
// everything itself, including the DB lookup added for token revocation.
async function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header." });
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret);

    // Token revocation: a JWT is otherwise stateless, so this is the one
    // DB lookup that makes "log out" actually invalidate a token
    // server-side rather than just clearing it client-side (see
    // models/User.js's bumpTokenVersion, controllers/authController.js's
    // logout). A token signed before this feature existed has no
    // tokenVersion claim at all (undefined), which will never equal a
    // real integer — those tokens are correctly rejected, not
    // grandfathered in; the admin just logs in again once.
    const user = await User.findById(decoded.sub);
    if (!user || user.token_version !== decoded.tokenVersion) {
      return res.status(401).json({ error: "Invalid or expired token." });
    }

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
