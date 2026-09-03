// Read-only Railway deployment status for the Security Center — see
// controllers/guardianController.js's getSecurityStatus. Dormant unless
// env.railwayApiToken is set (config/env.js) — same "optional external
// integration" pattern as ai/providers/anthropicProvider.js.
//
// API details confirmed directly against Railway's own docs
// (docs.railway.com) on 2026-09-03, not guessed:
//   - Endpoint: https://backboard.railway.com/graphql/v2
//   - project/environment/service/deployment/commit/branch identifiers are
//     all auto-injected into this exact running process as plain env vars
//     (RAILWAY_PROJECT_ID, RAILWAY_ENVIRONMENT_ID, RAILWAY_SERVICE_ID,
//     RAILWAY_DEPLOYMENT_ID, RAILWAY_GIT_COMMIT_SHA, RAILWAY_GIT_BRANCH) —
//     no new configuration needed for these, only the API token itself.
//   - Auth header format has two documented variants depending on token
//     type (personal/account token vs. a project-scoped "project token"),
//     and Railway's own docs don't state which a given token needs —
//     attemptAuthed() below tries the standard one first and falls back
//     to the other on a 401, so either token type this app's README told
//     the user to create actually works without needing to know in
//     advance which kind they generated.
const env = require("../config/env");

const GRAPHQL_ENDPOINT = "https://backboard.railway.com/graphql/v2";
const REQUEST_TIMEOUT_MS = 8000;

// Short-TTL in-memory cache — this data is polled by the dashboard, not
// requested once, so without this every poll tick would be a fresh
// external API call. Single-process, single-instance app (see
// lib/analysisProgress.js for the same reasoning) — no shared cache needed
// across instances.
const CACHE_TTL_MS = 30 * 1000;
let cache = { at: 0, value: null };

function isConfigured() {
  return Boolean(env.railwayApiToken);
}

async function graphqlRequest(query, variables, authHeaderName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [authHeaderName]: authHeaderName === "Authorization" ? `Bearer ${env.railwayApiToken}` : env.railwayApiToken,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    return { res, body: await res.json().catch(() => null) };
  } finally {
    clearTimeout(timer);
  }
}

// Tries the standard account-token header first; if that specifically
// comes back unauthorized, retries once with the project-token header
// style instead. Remembers which one worked for the rest of this
// process's lifetime so steady-state polling never pays for two requests.
let workingAuthHeader = null;

async function graphqlRequestAuthed(query, variables) {
  const headersToTry = workingAuthHeader ? [workingAuthHeader] : ["Authorization", "Project-Access-Token"];
  let last;
  for (const headerName of headersToTry) {
    last = await graphqlRequest(query, variables, headerName);
    if (last.res.ok && last.body && !last.body.errors) {
      workingAuthHeader = headerName;
      return last;
    }
    if (last.res.status !== 401 && last.res.status !== 403) break; // not an auth problem — retrying the other header won't help
  }
  return last;
}

function classifyFailure(result) {
  if (!result) return { available: false, detail: "Could not reach Railway's API." };
  const { res, body } = result;
  if (res.status === 401 || res.status === 403) {
    return { available: false, detail: "Railway rejected the configured token — check RAILWAY_API_TOKEN's scope/validity." };
  }
  if (!res.ok) {
    return { available: false, detail: `Railway API returned HTTP ${res.status}.` };
  }
  if (body?.errors?.length) {
    return { available: false, detail: `Railway API error: ${body.errors[0]?.message || "unknown"}.` };
  }
  return null;
}

const DEPLOYMENT_FIELDS = `id status createdAt url staticUrl`;

async function fetchDeployments(limit) {
  const query = `
    query deployments($input: DeploymentListInput!, $first: Int) {
      deployments(input: $input, first: $first) {
        edges { node { ${DEPLOYMENT_FIELDS} } }
      }
    }
  `;
  const variables = {
    input: {
      projectId: process.env.RAILWAY_PROJECT_ID || null,
      environmentId: process.env.RAILWAY_ENVIRONMENT_ID || null,
      serviceId: process.env.RAILWAY_SERVICE_ID || null,
    },
    first: limit,
  };
  const result = await graphqlRequestAuthed(query, variables);
  const failure = classifyFailure(result);
  if (failure) return failure;
  const edges = result.body?.data?.deployments?.edges;
  if (!Array.isArray(edges)) {
    return { available: false, detail: "Railway API response didn't include the expected deployment data." };
  }
  return { available: true, deployments: edges.map((e) => e.node) };
}

// The Security Center's "System Status" panel entry — current deployment
// health, not history. Uses RAILWAY_DEPLOYMENT_ID (already known from the
// running process's own env, no query needed) to find this exact
// deployment in the list rather than assuming the most recent list entry
// is necessarily this one (a redeploy could be racing this very request).
async function getCurrentDeploymentStatus() {
  if (!isConfigured()) return { configured: false, available: false };
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.value) return cache.value;

  const result = await fetchDeployments(10);
  let value;
  if (!result.available) {
    value = { configured: true, available: false, detail: result.detail };
  } else {
    const currentId = process.env.RAILWAY_DEPLOYMENT_ID;
    const current = result.deployments.find((d) => d.id === currentId) || result.deployments[0] || null;
    value = {
      configured: true,
      available: true,
      deployment: current,
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA || null,
      branch: process.env.RAILWAY_GIT_BRANCH || null,
    };
  }
  cache = { at: Date.now(), value };
  return value;
}

// Deployment-history view — a fresh call, not the cached current-status
// one (different shape, different consumer, and history is looked at
// deliberately/occasionally rather than polled).
async function getDeploymentHistory(limit = 10) {
  if (!isConfigured()) return { configured: false, available: false };
  const result = await fetchDeployments(limit);
  if (!result.available) return { configured: true, available: false, detail: result.detail };
  return { configured: true, available: true, deployments: result.deployments };
}

module.exports = { isConfigured, getCurrentDeploymentStatus, getDeploymentHistory };
