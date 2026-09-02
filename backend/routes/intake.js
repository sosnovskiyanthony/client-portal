const express = require("express");
const multer = require("multer");
const intakeController = require("../controllers/intakeController");
const { submissionLimiter, uploadLimiter } = require("../middleware/rateLimit");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

// submissionLimiter applies only to the actual form-submit endpoints now —
// /web-design/assets has its own uploadLimiter below (see
// middleware/rateLimit.js for why they're kept separate).
router.post("/web-design", submissionLimiter, asyncHandler(intakeController.webDesign));
router.post("/seo", submissionLimiter, asyncHandler(intakeController.seo));
router.post("/services", submissionLimiter, asyncHandler(intakeController.services));

// Brand-asset uploads on the web-design intake form (see
// intakeController.uploadBrandAssets / services/storage.js). Buffered in
// memory, never written to disk — Railway's app containers don't persist
// local disk across restarts/redeploys, and these files are small enough
// (see limits below) that streaming straight through to Supabase Storage
// without ever touching this server's disk is both simpler and safer.
const MAX_FILES = 5;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES } });

function handleUpload(req, res, next) {
  upload.array("files", MAX_FILES)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "One or more files exceed the 15MB limit."
          : err.code === "LIMIT_FILE_COUNT"
            ? "You can attach up to 5 files."
            : `Upload error: ${err.message}`;
      return res.status(400).json({ error: message });
    }
    if (err) return next(err);
    next();
  });
}

router.post("/web-design/assets", uploadLimiter, handleUpload, asyncHandler(intakeController.uploadBrandAssets));

module.exports = router;
