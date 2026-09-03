// Read-only Sentry error stats for the Security Center — see
// controllers/guardianController.js's getSecurityStatus. Dormant unless
// both env.sentryAuthToken AND env.sentryDsn are set (the DSN is where the
// org/project numeric IDs come from — see the parseDsn comment below).
// API shape confirmed directly against Sentry's own docs (docs.sentry.io)
// on 2026-09-03, not guessed. Distinct from instrument.js's Sentry.init()
// (which only ever WRITES events, via SENTRY_DSN) — this reads them back,
// via SENTRY_AUTH_TOKEN, a genuinely different credential.
const env = require("../config/env");

const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30 * 1000;
let cache = { at: 0, value: null };

// Sentry DSNs are shaped like https://<public_key>@o<org_id>.ingest.
// <region>.sentry.io/<project_id> — both org and project accept numeric
// IDs in Sentry's REST API (confirmed in docs), so this is enough to
// query the API without asking the user for separate org/project slugs.
function parseDsn(dsn) {
  try {
    const url = new URL(dsn);
    const orgMatch = url.hostname.match(/^o(\d+)\./);
    const projectId = url.pathname.replace(/^\//, "");
    if (!orgMatch || !projectId) return null;
    return { orgId: orgMatch[1], projectId };
  } catch {
    return null;
  }
}

function isConfigured() {
  return Boolean(env.sentryAuthToken && env.sentryDsn && parseDsn(env.sentryDsn));
}

async function sentryRequest(path, params = {}) {
  const url = new URL(`https://sentry.io/api/0${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.append(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.sentryAuthToken}` },
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    // Sentry's list endpoints are purely cursor-paginated — no total-count
    // header or field exists (confirmed against docs.sentry.io's own
    // pagination page). The Link header's results="true" on the "next"
    // relation is the only signal that more exist past this page; without
    // reading it, reporting body.length as "the" count would silently
    // undercount past the first page. See hasMore() below.
    return { res, body, linkHeader: res.headers.get("link") };
  } catch (err) {
    return { err };
  } finally {
    clearTimeout(timer);
  }
}

function classifyFailure(result) {
  if (result.err) return { available: false, detail: "Could not reach Sentry's API." };
  const { res, body } = result;
  if (res.status === 401 || res.status === 403) {
    return { available: false, detail: "Sentry rejected the configured token — check SENTRY_AUTH_TOKEN's scope/validity." };
  }
  if (res.status === 404) {
    return { available: false, detail: "Sentry organization/project not found for the configured SENTRY_DSN." };
  }
  if (!res.ok) {
    return { available: false, detail: `Sentry API returned HTTP ${res.status}.` };
  }
  if (!Array.isArray(body)) {
    return { available: false, detail: "Sentry API response didn't include the expected issue list." };
  }
  return null;
}

// Parses the standard Link-header pagination format Sentry uses
// (rel="next"; results="true"/"false") to answer "is there at least one
// more page" — the only count-adjacent signal cursor pagination offers.
function hasMore(linkHeader) {
  if (!linkHeader) return false;
  const nextRel = linkHeader.split(",").find((part) => part.includes('rel="next"'));
  return Boolean(nextRel && nextRel.includes('results="true"'));
}

function summarizeIssue(issue) {
  return {
    id: issue.id,
    title: issue.title,
    level: issue.level,
    count: issue.count,
    userCount: issue.userCount,
    status: issue.status,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    culprit: issue.culprit,
    permalink: issue.permalink,
  };
}

// Deliberately does NOT report separate "errors today" / "errors this
// week" counts — Sentry's issue-count field is a lifetime total per
// issue, not time-windowed, and getting a genuinely accurate time-bucketed
// event count needs a different endpoint this hasn't been verified
// against yet. Reporting unresolvedCount + the most-recent and
// most-frequent unresolved issues is real, verified data; a fabricated-
// looking "12 today" would violate the one rule this whole feature can't
// bend on. Revisit if/when the stats endpoint is verified the same way
// the endpoints below were.
async function getIssueSummary() {
  if (!isConfigured()) return { configured: false, available: false };
  if (Date.now() - cache.at < CACHE_TTL_MS && cache.value) return cache.value;

  const { orgId, projectId } = parseDsn(env.sentryDsn);
  const [recentResult, frequentResult, browserResult] = await Promise.all([
    sentryRequest(`/organizations/${orgId}/issues/`, { project: projectId, query: "is:unresolved", sort: "date", limit: 10 }),
    sentryRequest(`/organizations/${orgId}/issues/`, { project: projectId, query: "is:unresolved", sort: "freq", limit: 10 }),
    // errorController.js tags every browser-reported error source:frontend
    // (its only entry point — see that file) — everything else Sentry
    // sees is necessarily server-side, so this one extra query is what
    // makes a real Browser-vs-Backend split possible instead of one
    // undifferentiated error count.
    sentryRequest(`/organizations/${orgId}/issues/`, { project: projectId, query: "is:unresolved source:frontend", sort: "date", limit: 10 }),
  ]);

  const recentFailure = classifyFailure(recentResult);
  const value = recentFailure
    ? { configured: true, ...recentFailure }
    : {
        configured: true,
        available: true,
        // Cursor-paginated, no total available (see hasMore's comment) —
        // these are "at least N", explicitly not precise totals, and the
        // UI must say so rather than presenting them as exact counts.
        unresolvedShown: recentResult.body.length,
        unresolvedHasMore: hasMore(recentResult.linkHeader),
        browserUnresolvedShown: classifyFailure(browserResult) ? null : browserResult.body.length,
        browserUnresolvedHasMore: classifyFailure(browserResult) ? null : hasMore(browserResult.linkHeader),
        recentIssues: recentResult.body.map(summarizeIssue),
        mostFrequentIssues: classifyFailure(frequentResult) ? [] : frequentResult.body.map(summarizeIssue),
      };
  cache = { at: Date.now(), value };
  return value;
}

module.exports = { isConfigured, getIssueSummary };
