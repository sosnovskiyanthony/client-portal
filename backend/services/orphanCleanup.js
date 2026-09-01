// Deletes brand-asset files sitting in Supabase Storage that no submission
// references anymore — the two ways that happens: a visitor selected files
// on the web-design intake form (which uploads immediately on selection —
// see frontend/js/web-design.js) but never actually submitted the form, or
// an admin removed a file/deleted a submission and the underlying object
// wasn't cleaned up (best-effort — see adminController.js's
// deleteSubmission/removeAsset).
//
// Admin-triggered only (see adminController.cleanupOrphanedAssets) — no
// automatic schedule. A solo-operator dashboard doesn't need a background
// cron job for this; if it ever does, Railway's own Cron Jobs feature is
// the right place to call this on a schedule, not an in-process timer here.
const Submission = require("../models/Submission");
const storage = require("./storage");

// Anything uploaded more recently than this is left alone even if
// unreferenced — a visitor could still be mid-form, and the upload-then-
// reference flow means there's always a real window between "file
// uploaded" and "form submitted" for a legitimate in-progress visitor.
const MIN_AGE_MS = 24 * 60 * 60 * 1000;

// Pure — separated out from cleanupOrphanedAssets below purely so it's
// testable without a real Supabase project or Postgres connection (see
// test/orphanCleanup.test.js).
function filterOrphaned(allFiles, referencedPaths, nowMs = Date.now()) {
  const cutoff = nowMs - MIN_AGE_MS;
  return allFiles.filter((f) => {
    if (referencedPaths.has(f.path)) return false;
    const createdAt = f.createdAt ? new Date(f.createdAt).getTime() : 0;
    return createdAt < cutoff;
  });
}

async function cleanupOrphanedAssets() {
  if (!storage.isConfigured()) {
    throw new Error("Supabase Storage is not configured.");
  }

  const [allFiles, referencedPaths] = await Promise.all([
    storage.listAllFiles(),
    Submission.getAllReferencedAssetPaths(),
  ]);

  const orphaned = filterOrphaned(allFiles, referencedPaths);
  if (orphaned.length === 0) {
    return { scanned: allFiles.length, deleted: 0, paths: [] };
  }

  const paths = orphaned.map((f) => f.path);
  await storage.deleteFiles(paths);
  return { scanned: allFiles.length, deleted: paths.length, paths };
}

module.exports = { cleanupOrphanedAssets, filterOrphaned, MIN_AGE_MS };
