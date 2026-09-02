const { randomUUID } = require("crypto");
const Submission = require("../models/Submission");
const { notifyNewSubmission } = require("../services/email");
const { EMAIL_RE, BRAND_ASSET_PATH_RE } = require("../lib/validators");
const storage = require("../services/storage");
const { SERVICE_DATA_KEYS, SERVICE_LABELS, isValidServiceSlug } = require("../lib/services");

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

// Per-service required fields for the multi-select "services" intake (see
// handleServicesIntake below) — same isMissing() gating as REQUIRED_FIELDS
// above, just keyed by service slug instead of submission type, since one
// 'services' submission can carry more than one of these nested field sets
// at once. web-design/seo here intentionally match REQUIRED_FIELDS above —
// selecting Web Design or SEO within the combined form asks the identical
// questions the dedicated web-design.html/seo.html forms do.
const REQUIRED_SERVICE_FIELDS = {
  "web-design": REQUIRED_FIELDS["web-design"],
  seo: REQUIRED_FIELDS.seo,
  "ai-integration": ["aiGoal", "businessProblem"],
  "app-building": ["appGoal", "coreWorkflows"],
  "web-management": ["existingUrl", "helpNeeded"],
};

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
      // web-design/seo submitted through their own dedicated forms are
      // still single-service by definition — populate services the same
      // way the one-time migration backfill does for pre-existing rows
      // (config/database.js), so every web-design/seo submission from here
      // on (not just historical ones) shows up under the new service
      // filter pills consistently, regardless of which form it came
      // through.
      services: type === "web-design" || type === "seo" ? [type] : undefined,
    });

    res.status(201).json({ submission });

    // Fire-and-forget — the submission already succeeded and was returned
    // above; a slow or failed email must never affect the response.
    // notifyNewSubmission already catches and logs its own errors
    // internally (services/email.js), so nothing needs to be caught here.
    notifyNewSubmission(submission);

    // AI analysis is deliberately NOT triggered here. It only ever runs when
    // an authenticated admin clicks "Analyze with AI" (or "Re-analyze") in
    // the dashboard — see adminController.analyzeSubmission /
    // services/runAnalysis.js. That's what lets Ollama stay completely shut
    // down between uses instead of needing to be running for every intake.
  };
}

// The multi-select "services" intake (frontend/services.html +
// frontend/js/services.js) — a prospect selects any combination of
// web-design/seo/ai-integration/app-building/web-management, and only the
// selected ones' question sections get validated/stored. Deliberately
// separate from makeIntakeHandler() above: that factory validates one flat
// REQUIRED_FIELDS[type] list against the whole body; this validates a
// dynamic set of nested per-service objects, one per selected service, so
// the two aren't the same shape of problem. Rate-limited the same way (see
// routes/intake.js) and follows the identical name/email/response/
// notify/never-auto-analyze conventions as every other intake handler here.
async function handleServicesIntake(req, res) {
  const data = req.body || {};
  const { name, email } = data;

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "A name is required." });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email is required." });
  }

  const selectedServices = Array.isArray(data.services) ? data.services.filter(isValidServiceSlug) : [];
  if (selectedServices.length === 0) {
    return res.status(400).json({ error: "Select at least one service." });
  }

  const projectDetails = { services: selectedServices };
  for (const slug of selectedServices) {
    const key = SERVICE_DATA_KEYS[slug];
    const serviceData = data[key];
    if (!serviceData || typeof serviceData !== "object" || Array.isArray(serviceData)) {
      return res.status(400).json({ error: `Missing details for ${SERVICE_LABELS[slug]}.` });
    }
    const missingField = (REQUIRED_SERVICE_FIELDS[slug] || []).find((field) => isMissing(serviceData[field]));
    if (missingField) {
      return res.status(400).json({ error: `Missing required field for ${SERVICE_LABELS[slug]}: ${missingField}.` });
    }
    projectDetails[key] = serviceData;
  }

  const submission = await Submission.create({
    type: "services",
    clientName: name.trim(),
    email: email.trim(),
    projectDetails,
    flexiblePaymentPreference: typeof data.flexiblePaymentPreference === "boolean" ? data.flexiblePaymentPreference : null,
    services: selectedServices,
  });

  res.status(201).json({ submission });

  notifyNewSubmission(submission);

  // Same discipline as every other intake handler — AI analysis is never
  // triggered automatically here either (see services.js's own AI pipeline,
  // only ever run from the admin dashboard).
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
  services: handleServicesIntake,
  uploadBrandAssets,
  sanitizeBrandAssets,
};
