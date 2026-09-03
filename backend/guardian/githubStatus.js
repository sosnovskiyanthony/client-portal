// Read-only GitHub Actions status for the Security Center — see
// controllers/guardianController.js's getSecurityStatus. Dormant unless
// env.githubToken is set. API shape confirmed directly against GitHub's
// own REST API docs (docs.github.com) on 2026-09-03, not guessed.
const env = require("../config/env");

const API_BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30 * 1000;

let cache = { at: 0, value: null };

function isConfigured() {
  return Boolean(env.githubToken);
}

async function githubRequest(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${env.githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    return { res, body };
  } catch (err) {
    return { err };
  } finally {
    clearTimeout(timer);
  }
}

function classifyFailure(result) {
  if (result.err) return { available: false, detail: "Could not reach GitHub's API." };
  const { res, body } = result;
  if (res.status === 401 || res.status === 403) {
    return { available: false, detail: "GitHub rejected the configured token — check GITHUB_TOKEN's scope/validity." };
  }
  if (res.status === 404) {
    return { available: false, detail: `GitHub repo "${env.githubRepo}" not found — check GITHUB_REPO and the token's repository access.` };
  }
  if (!res.ok) {
    return { available: false, detail: `GitHub API returned HTTP ${res.status}.` };
  }
  if (!body || !Array.isArray(body.workflow_runs)) {
    return { available: false, detail: "GitHub API response didn't include the expected workflow run data." };
  }
  return null;
}

function summarizeRun(run) {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    headSha: run.head_sha,
    headBranch: run.head_branch,
    event: run.event,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
  };
}

// The deployment pipeline's "GitHub Actions / Tests / Lint / Security
// Checks" stages all come from this one workflow run for the currently-
// deployed commit — see ci.yml, which runs lint+tests+coverage+audit+
// integrity-check as one job ("deterministic") plus an advisory AI-review
// job. There's no per-step API without a second request per run (GitHub's
// jobs endpoint) — the run's own overall status/conclusion is what the
// pipeline visualization actually needs; per-step detail is available via
// the returned htmlUrl for anyone who wants to look closer.
async function getWorkflowRunsForCommit(sha) {
  if (!isConfigured()) return { configured: false, available: false };
  if (!sha) return { configured: true, available: false, detail: "No commit SHA to look up." };

  const result = await githubRequest(`/repos/${env.githubRepo}/actions/runs`, { head_sha: sha, per_page: 10 });
  const failure = classifyFailure(result);
  if (failure) return { configured: true, ...failure };
  return { configured: true, available: true, runs: result.body.workflow_runs.map(summarizeRun) };
}

async function getRecentWorkflowRuns(limit = 15) {
  if (!isConfigured()) return { configured: false, available: false };
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.value) return cache.value;

  const result = await githubRequest(`/repos/${env.githubRepo}/actions/runs`, { per_page: limit });
  const failure = classifyFailure(result);
  const value = failure
    ? { configured: true, ...failure }
    : { configured: true, available: true, runs: result.body.workflow_runs.map(summarizeRun) };
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { isConfigured, getWorkflowRunsForCommit, getRecentWorkflowRuns };
