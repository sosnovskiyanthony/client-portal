// Shared across every controller that validates an email address — was
// independently redefined in authController.js, contactController.js, and
// intakeController.js (same regex, three copies, no way to know they stayed
// in sync except by checking manually).
const EMAIL_RE = /^\S+@\S+\.\S+$/;

module.exports = { EMAIL_RE };
