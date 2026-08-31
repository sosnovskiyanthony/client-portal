(() => {
  const TYPE_LABELS = {
    "web-design": "Web Design",
    seo: "SEO",
    contact: "Contact",
  };

  const STATUS_LABELS = {
    new: "New",
    reviewed: "Reviewed",
    contacted: "Contacted",
  };

  // Sourced from the shared FIELD_LABELS in common.js (loaded before this
  // file) rather than defined locally — same underlying data web-design.js,
  // seo.js, and contact.js each use for their own live-summary rendering.
  const GOAL_LABELS = FIELD_LABELS.goal;
  const BRAND_LABELS = FIELD_LABELS.brandStatus;
  const FEATURE_LABELS = FIELD_LABELS.features;
  const CONTENT_LABELS = FIELD_LABELS.contentReadiness;
  const TIMELINE_LABELS = FIELD_LABELS.timeline;
  const CHALLENGE_LABELS = FIELD_LABELS.challenge;
  const VISIBILITY_LABELS = FIELD_LABELS.visibility;
  const REASON_LABELS = FIELD_LABELS.reason;

  const FIELD_CONFIG = {
    "web-design": [
      { key: "goal", label: "Goal", map: GOAL_LABELS },
      { key: "summary", label: "Summary" },
      { key: "brandStatus", label: "Brand guidelines", map: BRAND_LABELS },
      { key: "features", label: "Features", map: FEATURE_LABELS, isList: true },
      { key: "contentReadiness", label: "Content readiness", map: CONTENT_LABELS },
      { key: "timeline", label: "Timeline", map: TIMELINE_LABELS },
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "website", label: "Website" },
    ],
    seo: [
      { key: "url", label: "Website URL" },
      { key: "keywords", label: "Target keywords" },
      { key: "challenge", label: "Traffic challenge", map: CHALLENGE_LABELS },
      { key: "visibility", label: "Search visibility", map: VISIBILITY_LABELS },
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "notes", label: "Notes" },
    ],
    contact: [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "reason", label: "Reason", map: REASON_LABELS },
      { key: "message", label: "Message" },
    ],
  };

  const els = {
    gate: document.getElementById("admin-gate"),
    dashboard: document.getElementById("admin-dashboard"),
    btnLogin: document.getElementById("btn-admin-login"),
    btnLogout: document.getElementById("btn-admin-logout"),
    adminSub: document.getElementById("admin-sub"),
    filters: document.getElementById("admin-filters"),
    list: document.getElementById("submission-list"),
    pagination: document.getElementById("admin-pagination"),
  };

  // Filtering and pagination are both server-driven (see GET
  // /api/admin/submissions?type=&page=) — cachedSubmissions holds only the
  // current page's rows, not the whole table, so this scales past a couple
  // dozen submissions instead of shipping every row on every load.
  let currentType = "all";
  let currentPage = 1;
  let paginationMeta = { total: 0, totalPages: 1, pageSize: 20 };
  let cachedSubmissions = [];
  // Submission IDs with an analyze/re-analyze request currently in flight
  // from this browser tab. renderAnalysisSection() consults this so the
  // button stays disabled/"Analyzing…" across any unrelated re-render
  // (a filter click, another card's status change, etc.) — renderList()
  // rebuilds the whole list's HTML, which would otherwise silently drop
  // the disabled state mid-request and let a second click fire a duplicate
  // analysis on top of the one still running.
  const analyzingIds = new Set();

  async function render() {
    if (!isAdminLoggedIn()) {
      els.dashboard.hidden = true;
      els.gate.hidden = false;
      return;
    }

    els.gate.hidden = true;
    els.dashboard.hidden = false;
    await loadSubmissions();
  }

  const ANALYSIS_STATUS_LABELS = {
    pending: "Pending",
    processing: "Analyzing…",
    completed: "Completed",
    failed: "Failed",
  };

  const SEVERITY_LABELS = { low: "Low", medium: "Medium", high: "High" };
  const SCOPE_LABELS = { small: "Small", medium: "Medium", large: "Large", complex_custom: "Complex / custom" };

  function renderStringList(items, emptyText) {
    if (!Array.isArray(items) || items.length === 0) {
      return `<p class="analysis-empty">${escapeHtml(emptyText || "None noted.")}</p>`;
    }
    return `<ul class="analysis-list">${items.map((i) => `<li>${escapeHtml(String(i))}</li>`).join("")}</ul>`;
  }

  function renderRisks(risks) {
    if (!Array.isArray(risks) || risks.length === 0) {
      return `<p class="analysis-empty">No risks noted.</p>`;
    }
    return risks
      .map(
        (r) => `
        <div class="risk-item">
          <div class="risk-item-head">
            <span class="risk-name">${escapeHtml(r.risk || "")}</span>
            <span class="risk-severity risk-severity-${escapeHtml(r.severity || "")}">${escapeHtml(SEVERITY_LABELS[r.severity] || r.severity || "")}</span>
          </div>
          <p class="risk-explanation">${escapeHtml(r.explanation || "")}</p>
        </div>
      `
      )
      .join("");
  }

  // AI project analysis is only implemented for web-design submissions —
  // see backend/ai/aiService.js. Rendered as a distinct section within the
  // card so it reads clearly as internal-only, never client-facing content.
  function renderAnalysisSection(submission) {
    const a = submission.analysis;
    const btnLabel = a && a.status !== "pending" ? "Re-analyze with AI" : "Analyze with AI";

    // A request for this submission is in flight from this tab. Render this
    // unconditionally, regardless of what the last-known analysis object
    // says — this is what keeps the button correctly disabled even when
    // some unrelated action (a filter click, another card's status change)
    // forces a full re-render of the list while this fetch is still running.
    if (analyzingIds.has(submission.id)) {
      return `
        <div class="analysis-section">
          <div class="analysis-header">
            <span class="analysis-title">AI Project Analysis</span>
            <span class="analysis-status-badge analysis-status-processing">Analyzing…</span>
          </div>
          <p class="analysis-empty">Analyzing — this can take a couple of minutes with a local model.</p>
          <button class="btn btn-ghost analysis-btn" type="button" disabled>Analyzing…</button>
        </div>
      `;
    }

    if (!a) {
      return `
        <div class="analysis-section">
          <div class="analysis-header">
            <span class="analysis-title">AI Project Analysis</span>
            <span class="analysis-status-badge">Not analyzed</span>
          </div>
          <p class="analysis-empty">Not yet analyzed. AI analysis only runs when you click below — it never runs automatically.</p>
          <button class="btn btn-ghost analysis-btn" data-analyze-id="${submission.id}" type="button">Analyze with AI</button>
        </div>
      `;
    }

    const badge = `<span class="analysis-status-badge analysis-status-${a.status}">${ANALYSIS_STATUS_LABELS[a.status] || a.status}</span>`;

    if (a.status === "pending" || a.status === "processing") {
      // A real analysis run resolves itself (completed or failed) well within
      // this window — Ollama's own request timeout is 5 minutes. Past 6
      // minutes, the most likely explanation is the server restarted mid-run
      // and nothing is left running to ever finish it, so offer a manual
      // retry instead of leaving the admin stuck on "reload to check".
      const STUCK_THRESHOLD_MS = 6 * 60 * 1000;
      const elapsedMs = Date.now() - new Date(a.updatedAt).getTime();
      const isStuck = elapsedMs > STUCK_THRESHOLD_MS;

      return `
        <div class="analysis-section">
          <div class="analysis-header">
            <span class="analysis-title">AI Project Analysis</span>
            ${badge}
          </div>
          ${
            isStuck
              ? `<p class="analysis-error">This is taking much longer than expected — it likely got interrupted (e.g. by a server restart) and won't finish on its own.</p>
                 <button class="btn btn-ghost analysis-btn" data-analyze-id="${submission.id}" type="button">Retry Analysis with AI</button>`
              : `<p class="analysis-empty">Local models can take a couple of minutes. Reload the page to check for results.</p>`
          }
        </div>
      `;
    }

    if (a.status === "failed") {
      return `
        <div class="analysis-section">
          <div class="analysis-header">
            <span class="analysis-title">AI Project Analysis</span>
            ${badge}
          </div>
          <p class="analysis-error">${escapeHtml(a.error || "Analysis failed.")}</p>
          <button class="btn btn-ghost analysis-btn" data-analyze-id="${submission.id}" type="button">Retry Analysis with AI</button>
        </div>
      `;
    }

    const r = a.result || {};
    return `
      <div class="analysis-section">
        <div class="analysis-header">
          <span class="analysis-title">AI Project Analysis</span>
          ${badge}
        </div>

        <p class="analysis-summary">${escapeHtml(r.project_summary || "")}</p>

        <div class="analysis-pills">
          <span class="analysis-pill analysis-pill-${escapeHtml(r.complexity || "")}">Complexity: ${escapeHtml(r.complexity || "—")}</span>
          <span class="analysis-pill analysis-pill-${escapeHtml(r.priority || "")}">Priority: ${escapeHtml(r.priority || "—")}</span>
          <span class="analysis-pill">Scope: ${escapeHtml((r.scope_recommendation && SCOPE_LABELS[r.scope_recommendation.scope]) || "—")}</span>
          <span class="analysis-pill">Confidence: ${typeof r.confidence === "number" ? Math.round(r.confidence * 100) + "%" : "—"}</span>
        </div>

        <div class="analysis-grid">
          <div class="analysis-block">
            <span class="analysis-block-label">Scope reasoning</span>
            <p class="analysis-block-text">${escapeHtml((r.scope_recommendation && r.scope_recommendation.reasoning) || "")}</p>
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Timeline (preliminary — not a quote)</span>
            <p class="analysis-block-text">${
              r.timeline_recommendation
                ? escapeHtml(`Discovery ${r.timeline_recommendation.discovery} · Design ${r.timeline_recommendation.design} · Development ${r.timeline_recommendation.development} · QA & launch ${r.timeline_recommendation.qa_and_launch}`)
                : "—"
            }</p>
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Required features (client asked for)</span>
            ${renderStringList(r.required_features, "None explicitly required.")}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Recommended features (AI suggestion)</span>
            ${renderStringList(r.recommended_features, "None suggested.")}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Missing information</span>
            ${renderStringList(r.missing_information)}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Critical questions to ask</span>
            ${renderStringList(r.critical_questions)}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Nice-to-have questions</span>
            ${renderStringList(r.nice_to_have_questions)}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">SEO opportunities</span>
            ${renderStringList(r.seo_opportunities)}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Potential additional services</span>
            ${renderStringList(r.potential_additional_services)}
          </div>
          <div class="analysis-block analysis-block-notes">
            <span class="analysis-block-label">Internal notes (private — never shown to client)</span>
            ${renderStringList(r.internal_notes)}
          </div>
        </div>

        <div class="analysis-block">
          <span class="analysis-block-label">Potential risks</span>
          ${renderRisks(r.potential_risks)}
        </div>

        <details class="analysis-raw">
          <summary>Raw JSON (debug)</summary>
          <pre>${escapeHtml(JSON.stringify(r, null, 2))}</pre>
        </details>

        <p class="analysis-meta">${escapeHtml(a.provider || "")} · ${escapeHtml(a.model || "")} · prompt v${escapeHtml(a.promptVersion || "")}</p>
        <button class="btn btn-ghost analysis-btn" data-analyze-id="${submission.id}" type="button">${btnLabel}</button>
      </div>
    `;
  }

  function fieldValue(field, value) {
    if (field.isList) {
      if (!Array.isArray(value) || value.length === 0) return null;
      return value.map((v) => (field.map ? field.map[v] || v : v)).join(", ");
    }
    if (value === null || value === undefined || value === "") return null;
    return field.map ? field.map[value] || value : value;
  }

  function submissionCard(submission) {
    const config = FIELD_CONFIG[submission.type] || [];
    const details = submission.projectDetails || {};
    const fields = config
      .map((f) => ({ label: f.label, value: fieldValue(f, details[f.key]) }))
      .filter((f) => f.value !== null);

    const fieldsHtml = fields
      .map(
        (f) => `
        <div>
          <div class="submission-field-label">${escapeHtml(f.label)}</div>
          <div class="submission-field-value">${escapeHtml(String(f.value))}</div>
        </div>
      `
      )
      .join("");

    const time = new Date(submission.createdAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

    // created_at and updated_at are set by the same INSERT statement's
    // single now() call, so they're identical until the first real status
    // change — only show the "Updated" line once that's actually happened,
    // so untouched submissions don't show two identical timestamps.
    const wasUpdated = submission.updatedAt && submission.updatedAt !== submission.createdAt;
    const updatedTime = wasUpdated
      ? new Date(submission.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : null;

    const statusOptions = Object.keys(STATUS_LABELS)
      .map(
        (s) =>
          `<option value="${s}" ${s === submission.status ? "selected" : ""}>${STATUS_LABELS[s]}</option>`
      )
      .join("");

    return `
      <div class="submission-card" data-id="${submission.id}">
        <div class="submission-card-head">
          <div class="submission-card-head-left">
            <span class="submission-type">${escapeHtml(TYPE_LABELS[submission.type] || submission.type)}</span>
            <span class="submission-status submission-status-${submission.status}">${STATUS_LABELS[submission.status] || submission.status}</span>
          </div>
          <span class="submission-time">${escapeHtml(time)}${updatedTime ? ` <span class="submission-updated">· Updated ${escapeHtml(updatedTime)}</span>` : ""}</span>
        </div>
        <div class="submission-fields">${fieldsHtml}</div>
        <div class="submission-actions">
          <label class="submission-status-label">
            Status
            <select class="submission-status-select" data-id="${submission.id}">${statusOptions}</select>
          </label>
        </div>
        ${submission.type === "web-design" ? renderAnalysisSection(submission) : ""}
      </div>
    `;
  }

  async function loadSubmissions() {
    els.adminSub.textContent = "Loading…";
    els.list.innerHTML = "";
    els.pagination.innerHTML = "";

    try {
      const body = await fetchSubmissions({ type: currentType, page: currentPage });
      cachedSubmissions = body.submissions;
      paginationMeta = { total: body.total, totalPages: body.totalPages, pageSize: body.pageSize };
    } catch (err) {
      els.adminSub.textContent = err.message;
      els.list.innerHTML = `<div class="admin-empty">${escapeHtml(err.message)}</div>`;
      if (!isAdminLoggedIn()) render();
      return;
    }

    renderList();
  }

  function renderList() {
    els.adminSub.textContent =
      paginationMeta.total === 0
        ? "No submissions yet — they'll show up here as people submit forms."
        : `${paginationMeta.total} submission${paginationMeta.total === 1 ? "" : "s"} received.`;

    if (cachedSubmissions.length === 0) {
      els.list.innerHTML = `<div class="admin-empty">${
        paginationMeta.total === 0
          ? "Nothing here yet. Submit the Web Design, SEO, or Contact form to see it appear."
          : "No submissions match this filter."
      }</div>`;
      els.pagination.innerHTML = "";
      return;
    }

    els.list.innerHTML = cachedSubmissions.map(submissionCard).join("");
    renderPagination();
  }

  function renderPagination() {
    const { total, totalPages, pageSize } = paginationMeta;
    if (totalPages <= 1) {
      els.pagination.innerHTML = "";
      return;
    }

    const start = (currentPage - 1) * pageSize + 1;
    const end = Math.min(currentPage * pageSize, total);

    els.pagination.innerHTML = `
      <button class="btn btn-ghost" id="pagination-prev" type="button" ${currentPage <= 1 ? "disabled" : ""}>Previous</button>
      <span class="pagination-status">Showing ${start}–${end} of ${total} (page ${currentPage} of ${totalPages})</span>
      <button class="btn btn-ghost" id="pagination-next" type="button" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
    `;
  }

  function initFilters() {
    els.filters.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill");
      if (!btn) return;
      els.filters.querySelectorAll(".pill").forEach((p) => p.classList.remove("selected"));
      btn.classList.add("selected");
      currentType = btn.dataset.filter;
      currentPage = 1;
      loadSubmissions();
    });
  }

  function initPagination() {
    els.pagination.addEventListener("click", (e) => {
      if (e.target.id === "pagination-prev" && currentPage > 1) {
        currentPage -= 1;
        loadSubmissions();
      } else if (e.target.id === "pagination-next" && currentPage < paginationMeta.totalPages) {
        currentPage += 1;
        loadSubmissions();
      }
    });
  }

  function initStatusControls() {
    els.list.addEventListener("change", async (e) => {
      const select = e.target.closest(".submission-status-select");
      if (!select) return;

      const id = Number(select.dataset.id);
      const status = select.value;
      select.disabled = true;

      try {
        const updated = await updateSubmissionStatus(id, status);
        const idx = cachedSubmissions.findIndex((s) => s.id === id);
        if (idx !== -1) cachedSubmissions[idx] = updated;
        renderList();
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      } finally {
        select.disabled = false;
      }
    });
  }

  function initAnalysisControls() {
    els.list.addEventListener("click", async (e) => {
      const btn = e.target.closest(".analysis-btn[data-analyze-id]");
      if (!btn) return;

      const id = Number(btn.dataset.analyzeId);
      if (analyzingIds.has(id)) return; // already in flight — ignore a stray duplicate click

      analyzingIds.add(id);
      renderList(); // immediately reflect the disabled state, and make it survive any later unrelated re-render

      try {
        const updated = await analyzeSubmission(id);
        const idx = cachedSubmissions.findIndex((s) => s.id === id);
        if (idx !== -1) cachedSubmissions[idx] = { ...cachedSubmissions[idx], analysis: updated };
        // #admin-sub is aria-live="polite" — this is what actually announces
        // the outcome to a screen reader, since the analysis card itself is
        // torn down and rebuilt via innerHTML (a fresh element isn't
        // reliably announced as a "live update" by most screen readers).
        const clientName = cachedSubmissions[idx] ? cachedSubmissions[idx].clientName : "submission";
        els.adminSub.textContent =
          updated.status === "completed"
            ? `AI analysis completed for ${clientName}.`
            : `AI analysis failed for ${clientName}: ${updated.error || "unknown error"}`;
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) {
          analyzingIds.delete(id);
          render();
          return;
        }
      } finally {
        analyzingIds.delete(id);
        renderList();
      }
    });
  }

  function init() {
    initCommon();
    initFilters();
    initStatusControls();
    initAnalysisControls();
    initPagination();

    els.btnLogin.addEventListener("click", () => openModal("login"));
    els.btnLogout.addEventListener("click", () => {
      logoutAdmin();
      render();
    });

    window.addEventListener("studio:admin-auth-change", render);

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
