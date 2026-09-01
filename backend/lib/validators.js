// Shared across every controller that validates an email address — was
// independently redefined in authController.js, contactController.js, and
// intakeController.js (same regex, three copies, no way to know they stayed
// in sync except by checking manually).
const EMAIL_RE = /^\S+@\S+\.\S+$/;

// Matches exactly the shape services/storage.js's uploadBrandAssets ever
// generates — brand-assets/<uuid>[.ext] — nothing else. Used both to
// sanitize brandAssets referenced in a submission (intakeController.js) and
// to gate which paths the admin signed-URL endpoint will even ask Supabase
// about (adminController.js). A prefix-only check (path.startsWith(...))
// is NOT enough here: "brand-assets/../../../etc/passwd" also starts with
// "brand-assets/" — anchoring the whole string to this shape closes that
// off, since a traversal sequence can't be expressed without an extra "/"
// that this pattern doesn't allow anywhere after the fixed prefix.
const BRAND_ASSET_PATH_RE = /^brand-assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[A-Za-z0-9]{1,9})?$/;

module.exports = { EMAIL_RE, BRAND_ASSET_PATH_RE };
