// Wraps Supabase Storage for brand-asset uploads (see
// controllers/intakeController.js's uploadBrandAssets and
// controllers/adminController.js's getAssetSignedUrl). Lazily instantiated —
// same "dormant unless configured" pattern as
// ai/providers/anthropicProvider.js's getClient() — so the app still boots
// and serves every other feature normally when SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY aren't set. Only the upload/view endpoints for
// brand assets are unavailable (503) until they're configured.
//
// The bucket is private: nothing here ever returns a public, permanent URL.
// Uploads go through this server (service role key, never sent to the
// browser); viewing goes through a short-lived signed URL generated
// on-demand (see createSignedUrl) rather than a stored one, since a stored
// URL would eventually expire silently.
const { createClient } = require("@supabase/supabase-js");
const env = require("../config/env");

let cachedClient = null;
function getClient() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) return null;
  if (!cachedClient) {
    cachedClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  }
  return cachedClient;
}

function isConfigured() {
  return getClient() !== null;
}

// `bucket` defaults to the brand-assets bucket so every existing call site
// (uploadBrandAssets, getAssetSignedUrl, etc.) keeps working unchanged —
// contractController.js is the only caller that ever passes a different
// one (env.supabaseContractsBucket), keeping contract PDFs in their own
// bucket, separate from brand assets.
async function uploadFile(path, buffer, contentType, bucket = env.supabaseBucket) {
  const client = getClient();
  if (!client) throw new Error("Supabase Storage is not configured.");
  const { error } = await client.storage
    .from(bucket)
    .upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

async function createSignedUrl(path, expiresInSeconds, bucket = env.supabaseBucket) {
  const client = getClient();
  if (!client) throw new Error("Supabase Storage is not configured.");
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// Bulk-remove — used both to delete a submission's attached files (when the
// submission itself is deleted, or a single asset is removed from it — see
// adminController.js) and by the orphaned-file cleanup job. No-op on an
// empty list rather than an error, since callers don't need to special-case it.
async function deleteFiles(paths) {
  if (!paths || paths.length === 0) return;
  const client = getClient();
  if (!client) throw new Error("Supabase Storage is not configured.");
  const { error } = await client.storage.from(env.supabaseBucket).remove(paths);
  if (error) throw new Error(error.message);
}

// Every object this app has ever uploaded lives under the "brand-assets/"
// folder inside the bucket (see uploadBrandAssets's path generation) —
// paginated since Supabase's list() caps each response (100 by default).
// Returns {path, createdAt} so the orphan-cleanup job can apply an age
// safety window before deleting anything (see services/orphanCleanup.js).
async function listAllFiles(prefix = "brand-assets") {
  const client = getClient();
  if (!client) throw new Error("Supabase Storage is not configured.");

  const pageSize = 100;
  let offset = 0;
  const all = [];

  while (true) {
    const { data, error } = await client.storage.from(env.supabaseBucket).list(prefix, {
      limit: pageSize,
      offset,
      sortBy: { column: "created_at", order: "asc" },
    });
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const item of data) {
      // Supabase's list() can also return a placeholder entry representing
      // the folder itself in some SDK versions — it has no id/metadata.
      // Skip anything that isn't a real file.
      if (!item.id) continue;
      all.push({ path: `${prefix}/${item.name}`, createdAt: item.created_at });
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}

module.exports = { isConfigured, uploadFile, createSignedUrl, deleteFiles, listAllFiles };
