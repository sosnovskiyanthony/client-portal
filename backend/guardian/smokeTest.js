#!/usr/bin/env node
// `npm run guardian:smoke` — read-only production smoke test. GET-only
// requests against the live public site: never submits the contact form,
// an intake questionnaire, or any other form, and never creates a lead,
// email, or contract. See guardian/rules.js and guardian/README.md.
"use strict";

const SITE_URL = (process.env.SITE_URL || "https://client-portal-production-d328.up.railway.app").replace(/\/$/, "");
const TIMEOUT_MS = 10000;
// A response slower than this doesn't fail the check on its own, just gets
// flagged in the printed report — Railway/Ollama-adjacent latency varies
// enough that a hard fail here would be noisy, not useful.
const SLOW_MS = 4000;

// path, and a content marker expected to appear in the response body — a
// cheap, real signal that the right page rendered (not a templating error,
// a 200 that's actually an error page, etc.), not just a status code.
const CHECKS = [
  { path: "/api/health", marker: "\"status\":\"ok\"", isJson: true },
  { path: "/", marker: "BrindLeaf" },
  { path: "/web-design-services.html", marker: "BrindLeaf" },
  { path: "/seo.html", marker: "BrindLeaf" },
  { path: "/ai-integration.html", marker: "AI Integration" },
  { path: "/app-building.html", marker: "App Building" },
  { path: "/web-management.html", marker: "Web Management" },
  { path: "/contact.html", marker: "BrindLeaf" },
  { path: "/services.html", marker: "BrindLeaf" },
];

async function checkOne({ path, marker }) {
  const url = `${SITE_URL}${path}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });
    const durationMs = Date.now() - start;
    const body = await res.text();
    const statusOk = res.status >= 200 && res.status < 300;
    const markerOk = body.includes(marker);

    return {
      path,
      ok: statusOk && markerOk,
      status: res.status,
      durationMs,
      slow: durationMs > SLOW_MS,
      reason: !statusOk ? `expected 2xx, got ${res.status}` : !markerOk ? `missing content marker "${marker}"` : null,
    };
  } catch (err) {
    return {
      path,
      ok: false,
      status: null,
      durationMs: Date.now() - start,
      slow: false,
      reason: err.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS}ms` : err.message,
    };
  }
}

async function main() {
  console.log(`BrindLeaf Guardian — production smoke test against ${SITE_URL}\n`);

  const results = await Promise.all(CHECKS.map(checkOne));

  let allOk = true;
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    const slowNote = r.slow ? " (slow)" : "";
    console.log(`${mark} ${r.path}  ${r.status ?? "—"}  ${r.durationMs}ms${slowNote}${r.reason ? `  — ${r.reason}` : ""}`);
    if (!r.ok) allOk = false;
  }

  console.log(`\n${allOk ? "All checks passed." : "One or more checks FAILED."}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("guardian:smoke crashed unexpectedly:", err);
  process.exit(1);
});
