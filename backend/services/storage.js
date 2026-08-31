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

async function uploadFile(path, buffer, contentType) {
  const client = getClient();
  if (!client) throw new Error("Supabase Storage is not configured.");
  const { error } = await client.storage
    .from(env.supabaseBucket)
    .upload(path, buffer, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

async function createSignedUrl(path, expiresInSeconds) {
  const client = getClient();
  if (!client) throw new Error("Supabase Storage is not configured.");
  const { data, error } = await client.storage.from(env.supabaseBucket).createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

module.exports = { isConfigured, uploadFile, createSignedUrl };
