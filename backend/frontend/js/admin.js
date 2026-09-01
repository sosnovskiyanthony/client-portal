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
    qualified: "Qualified",
    discovery: "Discovery",
    proposal_sent: "Proposal Sent",
    won: "Won",
    lost: "Lost",
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
    exportBtn: document.getElementById("export-csv-btn"),
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

  // Same reasoning as analyzingIds, for the "Draft Outreach Email" button.
  const draftingIds = new Set();

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

  const OUTCOME_LABELS = {
    in_progress: "In progress",
    completed: "Completed",
    abandoned: "Abandoned",
    lost: "Lost",
  };

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

        ${renderEmailDraftSection(submission)}
      </div>
    `;
  }

  // Only ever rendered from renderAnalysisSection's completed branch above —
  // drafting an outreach email requires a completed analysis to draft from
  // (see ai/emailPrompt.js's buildEmailContext), same restriction the server
  // enforces in adminController.draftEmail.
  function renderEmailDraftSection(submission) {
    const d = submission.emailDraft;

    if (draftingIds.has(submission.id)) {
      return `
        <div class="email-draft-section">
          <div class="email-draft-header">
            <span class="email-draft-title">Outreach Email</span>
            <span class="analysis-status-badge analysis-status-processing">Drafting…</span>
          </div>
          <p class="analysis-empty">Drafting — this can take a minute with a local model.</p>
          <button class="btn btn-ghost email-draft-btn" type="button" disabled>Drafting…</button>
        </div>
      `;
    }

    if (!d || d.status === "failed") {
      return `
        <div class="email-draft-section">
          <div class="email-draft-header">
            <span class="email-draft-title">Outreach Email</span>
          </div>
          ${
            d && d.status === "failed"
              ? `<p class="analysis-error">${escapeHtml(d.error || "Drafting failed.")}</p>`
              : `<p class="analysis-empty">Not yet drafted.</p>`
          }
          <button class="btn btn-ghost email-draft-btn" data-draft-email-id="${submission.id}" type="button">${d && d.status === "failed" ? "Retry Draft" : "Draft Outreach Email"}</button>
        </div>
      `;
    }

    if (d.status === "pending" || d.status === "processing") {
      return `
        <div class="email-draft-section">
          <div class="email-draft-header">
            <span class="email-draft-title">Outreach Email</span>
            <span class="analysis-status-badge analysis-status-processing">${ANALYSIS_STATUS_LABELS[d.status]}</span>
          </div>
          <p class="analysis-empty">Local models can take a minute. Reload the page to check for results.</p>
        </div>
      `;
    }

    return `
      <div class="email-draft-section">
        <div class="email-draft-header">
          <span class="email-draft-title">Outreach Email</span>
          <span class="analysis-status-badge analysis-status-completed">Drafted</span>
        </div>
        <p class="email-draft-subject"><strong>Subject:</strong> ${escapeHtml(d.subject || "")}</p>
        <p class="email-draft-body">${escapeHtml(d.body || "")}</p>
        <div class="email-draft-actions">
          <button class="btn btn-ghost email-draft-copy-btn" data-copy-id="${submission.id}" type="button">Copy Email</button>
          <button class="btn btn-ghost email-draft-btn" data-draft-email-id="${submission.id}" type="button">Regenerate</button>
          <span class="email-draft-copy-msg" aria-live="polite"></span>
        </div>
      </div>
    `;
  }

  // Submission IDs whose outcome <details> the admin has opened. renderList()
  // rebuilds every card's HTML from scratch, which would otherwise collapse
  // this section right after a save — same reasoning as analyzingIds above.
  const openOutcomeIds = new Set();

  // A manually-recorded post-hoc record of what actually happened on a
  // project — unlike AI analysis, this applies to every submission type,
  // not just web-design (see backend/models/ProjectOutcome.js).
  function renderOutcomeSection(submission) {
    const o = submission.outcome || {};
    const featuresText = Array.isArray(o.featuresDelivered) ? o.featuresDelivered.join("\n") : "";
    const outcomeOptions = ["", "in_progress", "completed", "abandoned", "lost"]
      .map((val) => {
        const label = val === "" ? "— Not recorded —" : OUTCOME_LABELS[val];
        const selected = (o.outcome || "") === val ? "selected" : "";
        return `<option value="${val}" ${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");
    const summaryText = o.outcome ? `Project Outcome — ${OUTCOME_LABELS[o.outcome] || o.outcome}` : "Project Outcome";
    const isOpen = openOutcomeIds.has(submission.id) ? "open" : "";

    return `
      <details class="outcome-section" data-outcome-id="${submission.id}" ${isOpen}>
        <summary class="outcome-summary">${escapeHtml(summaryText)}</summary>
        <div class="outcome-body">
          <div class="field-row">
            <label class="field">
              <span class="field-label">Outcome</span>
              <select class="field-input" data-field="outcome">${outcomeOptions}</select>
            </label>
            <label class="field">
              <span class="field-label">Actual timeline</span>
              <input class="field-input" data-field="actualTimeline" type="text" value="${escapeHtml(o.actualTimeline || "")}" />
            </label>
          </div>
          <div class="field-row">
            <label class="field">
              <span class="field-label">Quoted price ($)</span>
              <input class="field-input" data-field="quotedPrice" type="number" step="0.01" min="0" value="${o.quotedPrice ?? ""}" />
            </label>
            <label class="field">
              <span class="field-label">Final price ($)</span>
              <input class="field-input" data-field="finalPrice" type="number" step="0.01" min="0" value="${o.finalPrice ?? ""}" />
            </label>
          </div>
          <label class="field">
            <span class="field-label">Final scope</span>
            <textarea class="field-input field-textarea" data-field="finalScope" rows="2">${escapeHtml(o.finalScope || "")}</textarea>
          </label>
          <label class="field">
            <span class="field-label">Features delivered <span class="field-optional">(one per line)</span></span>
            <textarea class="field-input field-textarea" data-field="featuresDelivered" rows="3">${escapeHtml(featuresText)}</textarea>
          </label>
          <label class="field">
            <span class="field-label">Notes</span>
            <textarea class="field-input field-textarea" data-field="notes" rows="2">${escapeHtml(o.notes || "")}</textarea>
          </label>
          <div class="outcome-actions">
            <button class="btn btn-ghost outcome-save-btn" data-outcome-save-id="${submission.id}" type="button">Save Outcome</button>
            <span class="outcome-save-msg" aria-live="polite"></span>
          </div>
        </div>
      </details>
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

  // Brand assets live inside projectDetails.brandAssets (see
  // intakeController.uploadBrandAssets / sanitizeBrandAssets) rather than as
  // their own submission field — only ever populated on web-design intakes.
  // The bucket is private, so "View" fetches a fresh signed URL on click
  // rather than linking directly (see initAssetViewControls below).
  function renderBrandAssets(submission) {
    const assets = (submission.projectDetails && submission.projectDetails.brandAssets) || [];
    if (!Array.isArray(assets) || assets.length === 0) return "";

    return `
      <div class="submission-assets">
        <div class="submission-field-label">Brand assets</div>
        <ul class="submission-asset-list">
          ${assets
            .map(
              (a) => `
            <li class="submission-asset-item">
              <span class="submission-asset-name">${escapeHtml(a.filename || a.path)}</span>
              <button class="btn btn-ghost submission-asset-view-btn" data-asset-path="${escapeHtml(a.path)}" type="button">View</button>
            </li>
          `
            )
            .join("")}
        </ul>
      </div>
    `;
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
        ${renderBrandAssets(submission)}
        <div class="submission-actions">
          <label class="submission-status-label">
            Status
            <select class="submission-status-select" data-id="${submission.id}">${statusOptions}</select>
          </label>
        </div>
        ${submission.type === "web-design" ? renderAnalysisSection(submission) : ""}
        ${renderOutcomeSection(submission)}
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
      <button class="btn btn-ghost btn-ghost-collapse" id="pagination-prev" type="button" ${currentPage <= 1 ? "disabled" : ""}>Previous</button>
      <span class="pagination-status">Showing ${start}–${end} of ${total} (page ${currentPage} of ${totalPages})</span>
      <button class="btn btn-ghost btn-ghost-collapse" id="pagination-next" type="button" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
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

  function initEmailDraftControls() {
    els.list.addEventListener("click", async (e) => {
      const copyBtn = e.target.closest(".email-draft-copy-btn[data-copy-id]");
      if (copyBtn) {
        const id = Number(copyBtn.dataset.copyId);
        const submission = cachedSubmissions.find((s) => s.id === id);
        const draft = submission && submission.emailDraft;
        const msg = copyBtn.closest(".email-draft-actions").querySelector(".email-draft-copy-msg");
        if (!draft) return;

        try {
          await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
          msg.textContent = "Copied.";
        } catch (err) {
          msg.textContent = "Couldn't copy — select the text manually.";
        }
        return;
      }

      const draftBtn = e.target.closest(".email-draft-btn[data-draft-email-id]");
      if (!draftBtn) return;

      const id = Number(draftBtn.dataset.draftEmailId);
      if (draftingIds.has(id)) return; // already in flight — ignore a stray duplicate click

      draftingIds.add(id);
      renderList(); // immediately reflect the disabled state, same reasoning as initAnalysisControls

      try {
        const updated = await draftEmail(id);
        const idx = cachedSubmissions.findIndex((s) => s.id === id);
        if (idx !== -1) cachedSubmissions[idx] = { ...cachedSubmissions[idx], emailDraft: updated };
        const clientName = cachedSubmissions[idx] ? cachedSubmissions[idx].clientName : "submission";
        els.adminSub.textContent =
          updated.status === "completed"
            ? `Outreach email drafted for ${clientName}.`
            : `Email draft failed for ${clientName}: ${updated.error || "unknown error"}`;
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) {
          draftingIds.delete(id);
          render();
          return;
        }
      } finally {
        draftingIds.delete(id);
        renderList();
      }
    });
  }

  function initAssetViewControls() {
    els.list.addEventListener("click", async (e) => {
      const btn = e.target.closest(".submission-asset-view-btn[data-asset-path]");
      if (!btn) return;

      const path = btn.dataset.assetPath;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Loading…";

      // Most browsers only allow window.open() to succeed when it's called
      // synchronously within the original click — once anything is awaited
      // first, it's silently blocked as a popup (returns null, doesn't
      // throw). Opening a blank tab right here, then redirecting it once the
      // signed URL resolves, keeps this inside the trusted-gesture window.
      const win = window.open("", "_blank", "noopener");

      try {
        const url = await getAssetSignedUrl(path);
        if (win) {
          win.location = url;
        } else {
          els.adminSub.textContent = "Your browser blocked the new tab — allow pop-ups for this site and try again.";
        }
      } catch (err) {
        if (win) win.close();
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
  }

  function initOutcomeControls() {
    // "toggle" doesn't bubble, so delegation needs the capture phase — this
    // is what keeps a section open across the renderList() a save triggers.
    els.list.addEventListener(
      "toggle",
      (e) => {
        const details = e.target.closest(".outcome-section");
        if (!details) return;
        const id = Number(details.dataset.outcomeId);
        if (details.open) openOutcomeIds.add(id);
        else openOutcomeIds.delete(id);
      },
      true
    );

    els.list.addEventListener("click", async (e) => {
      const btn = e.target.closest(".outcome-save-btn[data-outcome-save-id]");
      if (!btn) return;

      const id = Number(btn.dataset.outcomeSaveId);
      const section = btn.closest(".outcome-section");
      const msg = section.querySelector(".outcome-save-msg");
      const field = (name) => section.querySelector(`[data-field="${name}"]`).value;

      const payload = {
        outcome: field("outcome") || null,
        finalScope: field("finalScope") || null,
        actualTimeline: field("actualTimeline") || null,
        quotedPrice: field("quotedPrice") === "" ? null : Number(field("quotedPrice")),
        finalPrice: field("finalPrice") === "" ? null : Number(field("finalPrice")),
        featuresDelivered: field("featuresDelivered")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        notes: field("notes") || null,
      };

      btn.disabled = true;
      msg.textContent = "Saving…";

      try {
        const updated = await upsertOutcome(id, payload);
        const idx = cachedSubmissions.findIndex((s) => s.id === id);
        if (idx !== -1) cachedSubmissions[idx] = { ...cachedSubmissions[idx], outcome: updated };
        openOutcomeIds.add(id); // stay open through the re-render below so the save is visible
        renderList();
      } catch (err) {
        // Leave the form as-is on failure — no renderList() here — so the
        // admin doesn't lose what they typed.
        msg.textContent = err.message;
        btn.disabled = false;
        if (!isAdminLoggedIn()) render();
      }
    });
  }

  function initExport() {
    els.exportBtn.addEventListener("click", async () => {
      const original = els.exportBtn.textContent;
      els.exportBtn.disabled = true;
      els.exportBtn.textContent = "Exporting…";

      try {
        const { blob, filename } = await exportSubmissionsCsv(currentType);
        // A plain <a href> can't carry the Authorization header the export
        // endpoint requires, so the file arrives as a Blob (see
        // exportSubmissionsCsv in common.js) and this triggers the actual
        // save via a throwaway object URL.
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      } finally {
        els.exportBtn.disabled = false;
        els.exportBtn.textContent = original;
      }
    });
  }

  function init() {
    initCommon();
    initFilters();
    initStatusControls();
    initAnalysisControls();
    initEmailDraftControls();
    initAssetViewControls();
    initOutcomeControls();
    initPagination();
    initExport();

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
