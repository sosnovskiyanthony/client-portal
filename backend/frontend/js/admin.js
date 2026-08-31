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

  const GOAL_LABELS = {
    "lead-gen": "Lead Generation / Sales",
    ecommerce: "E-Commerce Storefront",
    brand: "Brand Authority / Portfolio",
    webapp: "Custom Web App / SaaS",
  };
  const BRAND_LABELS = {
    established: "Fully established",
    expansion: "Needs expansion",
    scratch: "Starting from scratch",
  };
  const FEATURE_LABELS = {
    cms: "CMS Integration",
    animations: "Advanced Animations",
    integrations: "Third-Party Integrations",
    auth: "User Authentication / Portals",
    multilingual: "Multilingual Support",
  };
  const CONTENT_LABELS = {
    ready: "Ready to go",
    draft: "Rough draft",
    help: "Need complete help",
  };
  const TIMELINE_LABELS = {
    "2-4-weeks": "2–4 Weeks",
    "1-2-months": "1–2 Months",
    "3-plus-months": "3+ Months",
  };
  const CHALLENGE_LABELS = {
    "not-ranking": "Not ranking",
    "traffic-declining": "Traffic declining",
    "low-ctr": "Low click-through",
    "poor-conversion": "Poor conversion",
  };
  const VISIBILITY_LABELS = {
    "some-terms": "Ranking well for some terms",
    "barely-visible": "Barely visible",
    "not-sure": "Not sure",
  };
  const REASON_LABELS = {
    "new-project": "New project inquiry",
    "seo-question": "Question about SEO",
    general: "General question",
    other: "Other",
  };

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
  };

  let activeFilter = "all";
  let cachedSubmissions = [];

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

  function renderList(items, emptyText) {
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
      return `
        <div class="analysis-section">
          <div class="analysis-header">
            <span class="analysis-title">AI Project Analysis</span>
            ${badge}
          </div>
          <p class="analysis-empty">Local models can take a couple of minutes. Reload the page to check for results.</p>
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
            ${renderList(r.required_features, "None explicitly required.")}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Recommended features (AI suggestion)</span>
            ${renderList(r.recommended_features, "None suggested.")}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Missing information</span>
            ${renderList(r.missing_information)}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Critical questions to ask</span>
            ${renderList(r.critical_questions)}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Nice-to-have questions</span>
            ${renderList(r.nice_to_have_questions)}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">SEO opportunities</span>
            ${renderList(r.seo_opportunities)}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Potential additional services</span>
            ${renderList(r.potential_additional_services)}
          </div>
          <div class="analysis-block analysis-block-notes">
            <span class="analysis-block-label">Internal notes (private — never shown to client)</span>
            ${renderList(r.internal_notes)}
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
          <span class="submission-time">${escapeHtml(time)}</span>
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

    try {
      cachedSubmissions = await fetchSubmissions();
    } catch (err) {
      els.adminSub.textContent = err.message;
      els.list.innerHTML = `<div class="admin-empty">${escapeHtml(err.message)}</div>`;
      if (!isAdminLoggedIn()) render();
      return;
    }

    renderList();
  }

  function renderList() {
    const all = cachedSubmissions;
    const filtered = activeFilter === "all" ? all : all.filter((s) => s.type === activeFilter);

    els.adminSub.textContent =
      all.length === 0
        ? "No submissions yet — they'll show up here as people submit forms."
        : `${all.length} submission${all.length === 1 ? "" : "s"} received.`;

    if (filtered.length === 0) {
      els.list.innerHTML = `<div class="admin-empty">${
        all.length === 0
          ? "Nothing here yet. Submit the Web Design, SEO, or Contact form to see it appear."
          : "No submissions match this filter."
      }</div>`;
      return;
    }

    els.list.innerHTML = filtered.map(submissionCard).join("");
  }

  function initFilters() {
    els.filters.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill");
      if (!btn) return;
      els.filters.querySelectorAll(".pill").forEach((p) => p.classList.remove("selected"));
      btn.classList.add("selected");
      activeFilter = btn.dataset.filter;
      renderList();
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
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Analyzing…";

      try {
        const updated = await analyzeSubmission(id);
        const idx = cachedSubmissions.findIndex((s) => s.id === id);
        if (idx !== -1) cachedSubmissions[idx] = { ...cachedSubmissions[idx], analysis: updated };
        renderList();
      } catch (err) {
        els.adminSub.textContent = err.message;
        btn.disabled = false;
        btn.textContent = originalLabel;
        if (!isAdminLoggedIn()) render();
      }
    });
  }

  function init() {
    initCommon();
    initFilters();
    initStatusControls();
    initAnalysisControls();

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
