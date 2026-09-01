const { randomUUID } = require("crypto");
const Submission = require("../models/Submission");
const { notifyNewSubmission } = require("../services/email");
const { EMAIL_RE, BRAND_ASSET_PATH_RE } = require("../lib/validators");
const storage = require("../services/storage");

// Mirrors each form's own client-side "isComplete" gating on its submit
// button (frontend/js/web-design.js, frontend/js/seo.js) — server-side, so a
// direct API call (not just the real form) can't store a near-empty
// submission with nothing but a name and email.
const REQUIRED_FIELDS = {
  "web-design": ["goal", "summary", "brandStatus", "features", "contentReadiness", "timeline"],
  seo: ["url", "keywords", "challenge", "visibility"],
};

function isMissing(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return value === undefined || value === null;
}

// Brand assets on the web-design intake — uploaded ahead of the final
// submit (see uploadBrandAssets below), then referenced by path in the
// submitted projectDetails. This is the server's defense-in-depth check on
// that reference list for a submission arriving via a direct API call, not
// the real form — it can't verify a path was genuinely issued by
// uploadBrandAssets, but BRAND_ASSET_PATH_RE confines it to exactly the
// shape that endpoint could ever have produced (see lib/validators.js).
// SVG is deliberately excluded — it's an active format (can embed
// <script>), and an uploaded file gets served back to the admin via direct
// navigation on "View" (frontend/js/admin.js), not a sandboxed <img>. A
// malicious SVG uploaded through this public endpoint would execute in the
// admin's browser the moment they view it.
const ALLOWED_ASSET_CONTENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];
const MAX_BRAND_ASSETS = 5;

function sanitizeBrandAssets(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (a) =>
        a &&
        typeof a === "object" &&
        typeof a.path === "string" &&
        BRAND_ASSET_PATH_RE.test(a.path) &&
        ALLOWED_ASSET_CONTENT_TYPES.includes(a.contentType)
    )
    .slice(0, MAX_BRAND_ASSETS)
    .map((a) => ({
      path: a.path,
      filename: typeof a.filename === "string" ? a.filename.slice(0, 255) : "",
      contentType: a.contentType,
      sizeBytes: typeof a.sizeBytes === "number" && a.sizeBytes >= 0 ? a.sizeBytes : null,
    }));
}

function makeIntakeHandler(type) {
  return async function handleIntake(req, res) {
    const data = req.body || {};
    const { name, email } = data;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "A name is required." });
    }
    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email is required." });
    }

    const missingField = (REQUIRED_FIELDS[type] || []).find((field) => isMissing(data[field]));
    if (missingField) {
      return res.status(400).json({ error: `Missing required field: ${missingField}.` });
    }

    const projectDetails = { ...data };
    if ("brandAssets" in projectDetails) {
      projectDetails.brandAssets = sanitizeBrandAssets(projectDetails.brandAssets);
    }

    const submission = await Submission.create({
      type,
      clientName: name.trim(),
      email: email.trim(),
      projectDetails,
      flexiblePaymentPreference: typeof data.flexiblePaymentPreference === "boolean"
        ? data.flexiblePaymentPreference
        : null,
    });

    res.status(201).json({ submission });

    // Fire-and-forget — the submission already succeeded and was returned
    // above; a slow or failed email must never affect the response.
    notifyNewSubmission(submission).catch(() => {});

    // AI analysis is deliberately NOT triggered here. It only ever runs when
    // an authenticated admin clicks "Analyze with AI" (or "Re-analyze") in
    // the dashboard — see adminController.analyzeSubmission /
    // services/runAnalysis.js. That's what lets Ollama stay completely shut
    // down between uses instead of needing to be running for every intake.
  };
}

// Public (rate-limited via submissionLimiter — see routes/intake.js), called
// from web-design.js before the final form submit. Multer has already
// parsed the multipart body and enforced size/count limits by the time this
// runs (see routes/intake.js's handleUpload) — this only needs to validate
// content type and push the bytes on to Supabase Storage.
async function uploadBrandAssets(req, res) {
  if (!storage.isConfigured()) {
    return res.status(503).json({ error: "File uploads are not configured on this server." });
  }

  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: "No files provided." });
  }

  for (const file of files) {
    if (!ALLOWED_ASSET_CONTENT_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: `Unsupported file type: ${file.mimetype}.` });
    }
  }

  const uploaded = [];
  for (const file of files) {
    const ext = (file.originalname.match(/\.[a-zA-Z0-9]+$/) || [""])[0].slice(0, 10);
    const path = `brand-assets/${randomUUID()}${ext}`;
    try {
      await storage.uploadFile(path, file.buffer, file.mimetype);
    } catch (err) {
      console.error("[uploadBrandAssets] Supabase upload failed:", err);
      return res.status(502).json({ error: "Upload to storage failed. Please try again." });
    }
    uploaded.push({ path, filename: file.originalname, contentType: file.mimetype, sizeBytes: file.size });
  }

  res.status(201).json({ files: uploaded });
}

module.exports = {
  webDesign: makeIntakeHandler("web-design"),
  seo: makeIntakeHandler("seo"),
  uploadBrandAssets,
  sanitizeBrandAssets,
};
