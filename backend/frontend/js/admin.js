(() => {
  const TYPE_LABELS = {
    "web-design": "Web Design",
    seo: "SEO",
    contact: "Contact",
    services: "Multi-Service",
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

  // Per-selected-service field sets for a type: "services" submission's
  // nested projectDetails (see lib/services.js's SERVICE_DATA_KEYS,
  // controllers/intakeController.js's handleServicesIntake). web-design/seo
  // reuse FIELD_CONFIG["web-design"]/["seo"] directly below — those nested
  // sub-objects have the exact same field names as the dedicated forms.
  const SERVICES_SUB_FIELD_CONFIG = {
    "ai-integration": [
      { key: "aiGoal", label: "AI goal" },
      { key: "businessProblem", label: "Business problem" },
      { key: "currentProcess", label: "Current manual process" },
      { key: "hasExistingAi", label: "Existing AI tools" },
      { key: "dataInvolved", label: "Data involved" },
      { key: "integrations", label: "Integrations" },
    ],
    "app-building": [
      { key: "appGoal", label: "App goal" },
      { key: "coreWorkflows", label: "Core workflows" },
      { key: "userType", label: "User type" },
      { key: "requiredFeatures", label: "Required features" },
      { key: "dataToStore", label: "Data to store" },
      { key: "integrations", label: "Integrations" },
    ],
    "web-management": [
      { key: "existingUrl", label: "Existing URL" },
      { key: "helpNeeded", label: "Help needed" },
      { key: "engagementType", label: "Engagement type" },
      { key: "currentHosting", label: "Current hosting" },
      { key: "concerns", label: "Concerns" },
    ],
  };
  const SERVICES_DATA_KEYS = { "web-design": "webDesign", seo: "seo", "ai-integration": "aiIntegration", "app-building": "appBuilding", "web-management": "webManagement" };

  const els = {
    gate: document.getElementById("admin-gate"),
    dashboard: document.getElementById("admin-dashboard"),
    btnLogin: document.getElementById("btn-admin-login"),
    btnLogout: document.getElementById("btn-admin-logout"),
    adminSub: document.getElementById("admin-sub"),
    filters: document.getElementById("admin-filters"),
    search: document.getElementById("admin-search"),
    list: document.getElementById("submission-list"),
    pagination: document.getElementById("admin-pagination"),
    exportBtn: document.getElementById("export-csv-btn"),
    cleanupBtn: document.getElementById("cleanup-orphans-btn"),
    ollamaControl: document.getElementById("ollama-control"),
    ollamaDot: document.getElementById("ollama-status-dot"),
    ollamaText: document.getElementById("ollama-status-text"),
    ollamaToggleBtn: document.getElementById("ollama-toggle-btn"),
    guardianDot: document.getElementById("guardian-status-dot"),
    guardianText: document.getElementById("guardian-status-text"),
    guardianLastCheck: document.getElementById("guardian-last-check"),
    guardianRunBtn: document.getElementById("guardian-run-btn"),
    guardianHistory: document.getElementById("guardian-history"),
    aiControlDot: document.getElementById("ai-control-dot"),
    aiControlText: document.getElementById("ai-control-text"),
    aiControlReason: document.getElementById("ai-control-reason"),
    aiDisableBtn: document.getElementById("ai-disable-btn"),
    aiLockdownBtn: document.getElementById("ai-lockdown-btn"),
    aiEnableBtn: document.getElementById("ai-enable-btn"),
    securityEventsPanel: document.getElementById("security-events-panel"),
    securityEventsList: document.getElementById("security-events-list"),
  };

  // Filtering and pagination are both server-driven (see GET
  // /api/admin/submissions?type=&page=) — cachedSubmissions holds only the
  // current page's rows, not the whole table, so this scales past a couple
  // dozen submissions instead of shipping every row on every load.
  let currentType = "all";
  // Mutually exclusive with currentType — the three new service filter
  // pills filter the services array (see models/Submission.js) rather
  // than the type column, since one submission can match more than one of
  // them. Selecting a service pill sets currentType back to "all" and vice
  // versa (see initFilters below).
  let currentService = null;
  // Combines with currentType/currentService (all active filters narrow
  // together) — see models/Submission.js's buildWhereClause. Debounced on
  // input (initSearch below), not applied on every keystroke.
  let currentSearch = "";
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

  // Elapsed-time display for both of the above — a request can genuinely
  // take a couple of minutes against a local model, and a static
  // "Analyzing…" label gives no way to tell that apart from a hung
  // request. A ticking counter is a cheap, honest signal: as long as it's
  // counting up, the request is still alive from the browser's point of
  // view (see ai/providers/ollamaProvider.js for the matching server-side
  // timing logs, visible in Railway's log tab, which confirm what stage
  // the request on the Ollama side is actually at).
  const analyzingStartTimes = new Map();
  const draftingStartTimes = new Map();
  let elapsedTickHandle = null;

  // Ordered to match the stage strings lib/analysisProgress.js's
  // setStage() calls actually use server-side (see runAnalysis.js,
  // draftEmail.js, aiService.js, ollamaProvider.js) — this list IS the
  // step-order contract between backend and dashboard, not just labels.
  const ANALYSIS_STAGES = [
    { key: "preparing", label: "Preparing submission data" },
    { key: "sending", label: "Sending to Ollama" },
    { key: "generating", label: "Ollama is generating the analysis…" },
    { key: "validating", label: "Validating AI response" },
    { key: "saving", label: "Saving results" },
  ];
  const EMAIL_STAGES = [
    { key: "preparing", label: "Preparing analysis context" },
    { key: "sending", label: "Sending to Ollama" },
    { key: "generating", label: "Ollama is drafting the email…" },
    { key: "validating", label: "Validating draft" },
    { key: "saving", label: "Saving draft" },
  ];
  const STAGE_ORDER = ANALYSIS_STAGES.map((s) => s.key); // same order for both

  // What's actually sent as model input — see ai/prompt.js's
  // sanitizeWebDesignSubmission (analysis) and ai/emailPrompt.js's
  // buildEmailContext (email draft). Ollama has no external "sources" of
  // its own — this is genuinely the entire input, which is the honest
  // answer to "what is it using."
  const ANALYSIS_FEEDING_IN =
    "Goal, business summary, brand guidelines status, requested features, content readiness, target timeline, existing website (client name/email excluded)";
  const EMAIL_FEEDING_IN =
    "Client name, project summary, scope & timeline recommendations, required/recommended features, open questions — all from the completed analysis above";

  // Last-known progress per in-flight id, refreshed each tick from the
  // server. Cached (rather than re-fetched synchronously inline) so a
  // slow/failed poll just leaves the stage list showing its last-known
  // state for one more tick instead of flickering back to "no stage yet".
  const analysisProgressCache = new Map();
  const emailProgressCache = new Map();
  // Guards against a slow poll response for one id overlapping with the
  // next tick's poll for that same id — irrelevant at this poll rate in
  // practice, cheap to just not worry about it either way.
  const progressPollInFlight = new Set();

  function formatElapsed(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function renderStageList(stages) {
    return `
      <ol class="stage-list">
        ${stages
          .map(
            (s, i) => `
          <li class="stage-item ${i === 0 ? "active" : "pending"}" data-stage="${s.key}">
            <span class="stage-dot" aria-hidden="true"></span>
            <span class="stage-label">${escapeHtml(s.label)}</span>
          </li>`
          )
          .join("")}
      </ol>
    `;
  }

  // Applies the server-confirmed current stage to an already-rendered stage
  // list (in place — see renderStageList above for the initial markup) and
  // fills in the model name once known. Deliberately does nothing when
  // progress is missing/inactive rather than resetting to "preparing" —
  // a single missed poll shouldn't make a request that's actually well
  // underway look like it just started over.
  function applyStageProgress(section, progress) {
    if (!progress || !progress.active) return;
    const currentIdx = STAGE_ORDER.indexOf(progress.stage);
    if (currentIdx === -1) return;
    section.querySelectorAll(".stage-item").forEach((li) => {
      const idx = STAGE_ORDER.indexOf(li.dataset.stage);
      li.classList.remove("done", "active", "pending");
      li.classList.add(idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending");
    });
    if (progress.model) {
      const sendingLabel = section.querySelector('.stage-item[data-stage="sending"] .stage-label');
      if (sendingLabel && !sendingLabel.dataset.modelSet) {
        sendingLabel.textContent = `Sending to Ollama (${progress.model})`;
        sendingLabel.dataset.modelSet = "1";
      }
    }
  }

  // Updates the in-flight cards' text directly via the DOM rather than
  // going through renderList() — a full list re-render every second would
  // fight with anything else the admin is doing at the time (a status
  // dropdown open, scroll position, etc.) for no benefit here, since only
  // these elements per in-flight card actually change each tick.
  function tickElapsedLabels() {
    if (analyzingIds.size === 0 && draftingIds.size === 0) {
      clearInterval(elapsedTickHandle);
      elapsedTickHandle = null;
      return;
    }
    const now = Date.now();
    for (const id of analyzingIds) {
      const start = analyzingStartTimes.get(id);
      if (!start) continue;
      const section = els.list.querySelector(`.submission-card[data-id="${id}"] .analysis-section`);
      if (section) {
        const label = `Analyzing… ${formatElapsed(now - start)}`;
        const badge = section.querySelector(".analysis-status-badge");
        const btn = section.querySelector(".analysis-btn");
        if (badge) badge.textContent = label;
        if (btn) btn.textContent = label;
        applyStageProgress(section, analysisProgressCache.get(id));
      }
      pollProgress(id, "analysis");
    }
    for (const id of draftingIds) {
      const start = draftingStartTimes.get(id);
      if (!start) continue;
      const section = els.list.querySelector(`.submission-card[data-id="${id}"] .email-draft-section`);
      if (section) {
        const label = `Drafting… ${formatElapsed(now - start)}`;
        const badge = section.querySelector(".analysis-status-badge");
        const btn = section.querySelector(".email-draft-btn");
        if (badge) badge.textContent = label;
        if (btn) btn.textContent = label;
        applyStageProgress(section, emailProgressCache.get(id));
      }
      pollProgress(id, "email");
    }
  }

  function pollProgress(id, kind) {
    const pollKey = `${kind}:${id}`;
    if (progressPollInFlight.has(pollKey)) return;
    progressPollInFlight.add(pollKey);
    const fetchFn = kind === "analysis" ? getAnalysisProgress : getEmailDraftProgress;
    const cache = kind === "analysis" ? analysisProgressCache : emailProgressCache;
    fetchFn(id)
      .then((progress) => {
        if (progress) cache.set(id, progress);
      })
      .finally(() => progressPollInFlight.delete(pollKey));
  }

  function ensureElapsedTicking() {
    if (elapsedTickHandle) return;
    elapsedTickHandle = setInterval(tickElapsedLabels, 1000);
  }

  async function render() {
    if (!isAdminLoggedIn()) {
      els.dashboard.hidden = true;
      els.gate.hidden = false;
      return;
    }

    els.gate.hidden = true;
    els.dashboard.hidden = false;
    await loadSubmissions();
    refreshOllamaStatus();
    refreshGuardianPanel();
    refreshAiControlPanel();
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

  // seo_recommendations/feature_recommendations (ai/schema.js) are
  // additive fields — absent entirely on any analysis generated before
  // they existed, and legitimately empty when the AI decided SEO/new
  // features weren't relevant for this client. Both render nothing at all
  // in that case (returning "" here, checked by the caller below), rather
  // than an empty section header cluttering the dashboard.
  function renderSeoRecommendations(items) {
    if (!Array.isArray(items) || items.length === 0) return "";
    return items
      .map(
        (r) => `
        <div class="reco-item">
          <div class="reco-item-head">
            <span class="reco-name">${escapeHtml(r.recommendation || "")}</span>
            <span class="risk-severity risk-severity-${escapeHtml(r.priority || "")}">${escapeHtml(SEVERITY_LABELS[r.priority] || r.priority || "")}</span>
          </div>
          <p class="reco-field"><strong>Why:</strong> ${escapeHtml(r.why || "")}</p>
          <p class="reco-field"><strong>Expected value:</strong> ${escapeHtml(r.expected_value || "")}</p>
          <p class="reco-field"><strong>Evidence:</strong> ${escapeHtml(r.evidence || "")}</p>
          ${
            Array.isArray(r.sources) && r.sources.length
              ? `<p class="reco-field reco-sources"><strong>Sources:</strong> ${r.sources
                  .map((s) => `<a href="${escapeHtml(s.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url || "source")}</a>`)
                  .join(", ")}</p>`
              : ""
          }
        </div>
      `
      )
      .join("");
  }

  function renderFeatureRecommendations(items) {
    if (!Array.isArray(items) || items.length === 0) return "";
    return items
      .map(
        (r) => `
        <div class="reco-item">
          <div class="reco-item-head">
            <span class="reco-name">${escapeHtml(r.feature || "")}</span>
            <span class="risk-severity risk-severity-${escapeHtml(r.priority || "")}">${escapeHtml(SEVERITY_LABELS[r.priority] || r.priority || "")}</span>
          </div>
          <p class="reco-field"><strong>Problem solved:</strong> ${escapeHtml(r.problem_solved || "")}</p>
          <p class="reco-field"><strong>Reasoning:</strong> ${escapeHtml(r.reasoning || "")}</p>
          <p class="reco-field"><strong>Expected impact:</strong> ${escapeHtml(r.expected_impact || "")}</p>
          ${r.dependencies_considerations ? `<p class="reco-field"><strong>Dependencies/considerations:</strong> ${escapeHtml(r.dependencies_considerations)}</p>` : ""}
        </div>
      `
      )
      .join("");
  }

  // Ranked recommendations across every selected service (ServicesAnalysisSchema's
  // `recommendations` — see ai/servicesSchema.js) — a flat, comparable list,
  // not five disconnected per-service ones. "origin" is rendered as its own
  // badge so requested-vs-suggested is never ambiguous at a glance.
  function renderRankedRecommendations(items) {
    if (!Array.isArray(items) || items.length === 0) return "";
    return items
      .map(
        (r) => `
        <div class="reco-item">
          <div class="reco-item-head">
            <span class="reco-name">${escapeHtml(r.feature || "")}</span>
            <span class="reco-origin-badge reco-origin-${escapeHtml(r.origin || "")}">${r.origin === "requested" ? "Client requested" : "AI suggested"}</span>
            <span class="risk-severity risk-severity-${escapeHtml(r.priority || "")}">${escapeHtml(SEVERITY_LABELS[r.priority] || r.priority || "")}</span>
          </div>
          <p class="reco-field"><strong>Service:</strong> ${escapeHtml(SERVICE_LABELS[r.service] || r.service || "")}</p>
          <p class="reco-field"><strong>Why:</strong> ${escapeHtml(r.why || "")}</p>
          <p class="reco-field"><strong>Evidence:</strong> ${escapeHtml(r.evidence || "")}</p>
          <p class="reco-field"><strong>Expected value:</strong> ${escapeHtml(r.expected_value || "")}</p>
          <p class="reco-field"><strong>Confidence:</strong> ${typeof r.confidence === "number" ? Math.round(r.confidence * 100) + "%" : "—"}</p>
          ${r.considerations ? `<p class="reco-field"><strong>Considerations:</strong> ${escapeHtml(r.considerations)}</p>` : ""}
        </div>
      `
      )
      .join("");
  }

  // One collapsible block per populated per-service analysis section
  // (web_design_analysis/seo_analysis/ai_integration_analysis/
  // app_building_analysis/web_management_analysis) — only sections the AI
  // actually populated appear at all, matching "don't render a section for
  // a service that wasn't selected."
  const SERVICES_ANALYSIS_SECTION_KEYS = {
    "web-design": "web_design_analysis",
    seo: "seo_analysis",
    "ai-integration": "ai_integration_analysis",
    "app-building": "app_building_analysis",
    "web-management": "web_management_analysis",
  };

  function renderPerServiceAnalysis(r) {
    const blocks = Object.entries(SERVICES_ANALYSIS_SECTION_KEYS)
      .map(([slug, key]) => {
        const section = r[key];
        if (!section || typeof section !== "object") return "";
        const rows = Object.entries(section)
          .filter(([field]) => field !== "risks")
          .map(([field, value]) => {
            const label = field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
            const displayValue = Array.isArray(value) ? value.join(", ") : String(value ?? "");
            if (!displayValue) return "";
            return `<p class="reco-field"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(displayValue)}</p>`;
          })
          .join("");
        const risksHtml = Array.isArray(section.risks) && section.risks.length ? renderRisks(section.risks) : "";
        return `
          <div class="analysis-block">
            <span class="analysis-block-label">${escapeHtml(SERVICE_LABELS[slug] || slug)} analysis</span>
            ${rows}
            ${risksHtml ? `<div class="reco-field"><strong>Risks:</strong></div>${risksHtml}` : ""}
          </div>
        `;
      })
      .filter(Boolean);
    return blocks.join("");
  }

  // AI project analysis — see backend/ai/aiService.js. Covers both
  // web-design submissions (AnalysisSchema) and multi-select "services"
  // submissions (ServicesAnalysisSchema — see ai/servicesSchema.js).
  // Rendered as a distinct section within the card so it reads clearly as
  // internal-only, never client-facing content.
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
          ${renderStageList(ANALYSIS_STAGES)}
          <p class="analysis-feeding-in">Feeding in: ${escapeHtml(ANALYSIS_FEEDING_IN)}</p>
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
          <button class="btn btn-ghost chat-btn" data-chat-id="${submission.id}" data-chat-name="${escapeHtml(submission.clientName || 'this submission')}" type="button">Chat with AI</button>
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
    const isServicesResult = submission.type === "services";
    const seoRecoHtml = renderSeoRecommendations(r.seo_recommendations);
    const featureRecoHtml = renderFeatureRecommendations(r.feature_recommendations);
    const rankedRecommendationsHtml = isServicesResult ? renderRankedRecommendations(r.recommendations) : "";
    const perServiceAnalysisHtml = isServicesResult ? renderPerServiceAnalysis(r) : "";
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
          ${
            isServicesResult
              ? ""
              : `<div class="analysis-block">
                  <span class="analysis-block-label">SEO opportunities</span>
                  ${renderStringList(r.seo_opportunities)}
                </div>
                <div class="analysis-block">
                  <span class="analysis-block-label">Potential additional services</span>
                  ${renderStringList(r.potential_additional_services)}
                </div>`
          }
          <div class="analysis-block analysis-block-notes">
            <span class="analysis-block-label">Internal notes (private — never shown to client)</span>
            ${renderStringList(r.internal_notes)}
          </div>
        </div>

        ${perServiceAnalysisHtml}

        ${
          rankedRecommendationsHtml
            ? `<div class="analysis-block">
                <span class="analysis-block-label">Ranked recommendations</span>
                ${rankedRecommendationsHtml}
              </div>`
            : ""
        }

        ${
          seoRecoHtml
            ? `<div class="analysis-block">
                <span class="analysis-block-label">SEO recommendations</span>
                ${seoRecoHtml}
              </div>`
            : ""
        }

        ${
          featureRecoHtml
            ? `<div class="analysis-block">
                <span class="analysis-block-label">Feature recommendations</span>
                ${featureRecoHtml}
              </div>`
            : ""
        }

        ${
          isServicesResult
            ? ""
            : `<div class="analysis-block">
                <span class="analysis-block-label">Potential risks</span>
                ${renderRisks(r.potential_risks)}
              </div>`
        }

        <div class="analysis-reasoning">
          <span class="analysis-block-label">How the AI reached these conclusions</span>
          ${renderStringList(r.reasoning, "No reasoning was returned for this analysis.")}
        </div>

        <details class="analysis-raw">
          <summary>Raw JSON (debug)</summary>
          <pre>${escapeHtml(JSON.stringify(r, null, 2))}</pre>
        </details>

        <p class="analysis-meta">${escapeHtml(a.provider || "")} · ${escapeHtml(a.model || "")} · prompt v${escapeHtml(a.promptVersion || "")}</p>
        <button class="btn btn-ghost analysis-btn" data-analyze-id="${submission.id}" type="button">${btnLabel}</button>
        <button class="btn btn-ghost chat-btn" data-chat-id="${submission.id}" data-chat-name="${escapeHtml(submission.clientName || 'this submission')}" type="button">Chat with AI</button>

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
          ${renderStageList(EMAIL_STAGES)}
          <p class="analysis-feeding-in">Feeding in: ${escapeHtml(EMAIL_FEEDING_IN)}</p>
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
  // rather than linking directly (see initAssetControls below).
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
              <div class="submission-asset-actions">
                <button class="btn btn-ghost submission-asset-view-btn" data-asset-path="${escapeHtml(a.path)}" data-submission-id="${submission.id}" type="button">View</button>
                <button class="btn btn-ghost submission-asset-remove-btn" data-asset-path="${escapeHtml(a.path)}" data-submission-id="${submission.id}" type="button">Remove</button>
              </div>
            </li>
          `
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  // Renders the field list for a type: "services" submission — one block
  // per selected service, using FIELD_CONFIG["web-design"]/["seo"] for
  // those two (identical nested field names to their dedicated forms) and
  // SERVICES_SUB_FIELD_CONFIG for the three new services. Kept separate
  // from submissionCard()'s generic FIELD_CONFIG[type] path below since the
  // shape here is nested (one sub-object per selected service), not flat.
  function renderServicesFields(submission) {
    const details = submission.projectDetails || {};
    const services = Array.isArray(details.services) ? details.services : [];
    if (services.length === 0) return "";

    // Unlike web-design/seo (where name/email are spread into
    // projectDetails redundantly alongside the real clientName/email
    // columns), a services submission only ever stores them at the
    // top level (see intakeController.handleServicesIntake) — so this is
    // the one place that has to read submission.clientName/.email
    // directly rather than details.name/.email like FIELD_CONFIG does.
    const contactHtml = `
      <div>
        <div class="submission-field-label">Name</div>
        <div class="submission-field-value">${escapeHtml(submission.clientName || "")}</div>
      </div>
      <div>
        <div class="submission-field-label">Email</div>
        <div class="submission-field-value">${escapeHtml(submission.email || "")}</div>
      </div>
    `;

    return contactHtml + services
      .map((slug) => {
        const dataKey = SERVICES_DATA_KEYS[slug];
        const subConfig = FIELD_CONFIG[slug] || SERVICES_SUB_FIELD_CONFIG[slug] || [];
        const subDetails = (dataKey && details[dataKey]) || {};
        const fields = subConfig
          .map((f) => ({ label: f.label, value: fieldValue(f, subDetails[f.key]) }))
          .filter((f) => f.value !== null);
        if (fields.length === 0) return "";

        return `
          <div class="submission-service-block">
            <div class="submission-service-block-label">${escapeHtml(SERVICE_LABELS[slug] || slug)}</div>
            ${fields
              .map(
                (f) => `
              <div>
                <div class="submission-field-label">${escapeHtml(f.label)}</div>
                <div class="submission-field-value">${escapeHtml(String(f.value))}</div>
              </div>
            `
              )
              .join("")}
          </div>
        `;
      })
      .join("");
  }

  function submissionCard(submission) {
    const details = submission.projectDetails || {};
    const isServices = submission.type === "services";
    const config = FIELD_CONFIG[submission.type] || [];
    const fields = isServices
      ? []
      : config.map((f) => ({ label: f.label, value: fieldValue(f, details[f.key]) })).filter((f) => f.value !== null);

    const fieldsHtml = isServices
      ? renderServicesFields(submission)
      : fields
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
          <button class="btn btn-ghost submission-delete-btn" data-delete-id="${submission.id}" type="button">Delete</button>
        </div>
        ${submission.type === "web-design" || submission.type === "services" ? renderAnalysisSection(submission) : ""}
        ${renderOutcomeSection(submission)}
        ${renderContractSection(submission)}
      </div>
    `;
  }

  const CONTRACT_STATUS_LABELS = {
    draft: "Draft",
    needs_review: "Needs Review",
    ready_for_approval: "Ready for Approval",
    approved: "Approved",
    sent: "Sent",
    signed: "Signed",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  // Works for any submission type, same reasoning as renderOutcomeSection —
  // a contract can follow an SEO or contact inquiry too, not just
  // web-design. Shows the most recent contract if one or more exist (an
  // array, not 1:1 like analysis/emailDraft — see models/Contract.js), or
  // a Create Contract action if none does. The actual create happens here
  // (a real API call, not just a navigation), then redirects straight into
  // the builder for the new contract.
  function renderContractSection(submission) {
    const contracts = submission.contracts || [];
    if (contracts.length === 0) {
      return `
        <div class="contract-inline-section">
          <span class="analysis-title">Contract</span>
          <button class="btn btn-ghost contract-create-btn" data-submission-id="${submission.id}" type="button">Create Contract</button>
        </div>
      `;
    }
    const latest = contracts[0];
    return `
      <div class="contract-inline-section">
        <span class="analysis-title">Contract</span>
        <a class="contract-inline-link" href="admin-contracts.html?contract=${latest.id}">
          ${escapeHtml(latest.contractNumber)}
          <span class="contract-status-badge contract-status-${escapeHtml(latest.status)}">${escapeHtml(CONTRACT_STATUS_LABELS[latest.status] || latest.status)}</span>
        </a>
        ${contracts.length > 1 ? `<span class="contract-inline-more">+${contracts.length - 1} more</span>` : ""}
      </div>
    `;
  }

  function initContractCreation() {
    els.list.addEventListener("click", async (e) => {
      const btn = e.target.closest(".contract-create-btn[data-submission-id]");
      if (!btn) return;
      const submissionId = Number(btn.dataset.submissionId);
      btn.disabled = true;
      btn.textContent = "Creating…";
      try {
        const contract = await createContractFromSubmission(submissionId);
        window.location.href = `admin-contracts.html?contract=${contract.id}`;
      } catch (err) {
        els.adminSub.textContent = err.message;
        btn.disabled = false;
        btn.textContent = "Create Contract";
        if (!isAdminLoggedIn()) render();
      }
    });
  }

  async function loadSubmissions() {
    els.adminSub.textContent = "Loading…";
    els.list.innerHTML = "";
    els.pagination.innerHTML = "";

    try {
      const body = await fetchSubmissions({ type: currentType, service: currentService, search: currentSearch, page: currentPage });
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
      if (btn.dataset.filterService) {
        currentService = btn.dataset.filterService;
        currentType = "all";
      } else {
        currentType = btn.dataset.filter;
        currentService = null;
      }
      currentPage = 1;
      loadSubmissions();
    });
  }

  // Live-as-you-type, debounced — combines with whatever type/service
  // filter is currently active (currentSearch is just one more term
  // fetchSubmissions/exportSubmissionsCsv already thread through, see
  // models/Submission.js's buildWhereClause). 300ms is long enough that a
  // normal typing cadence doesn't fire a request per keystroke, short
  // enough to still feel immediate.
  const SEARCH_DEBOUNCE_MS = 300;
  let searchDebounceTimer = null;

  function initSearch() {
    if (!els.search) return;
    els.search.addEventListener("input", () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        currentSearch = els.search.value.trim();
        currentPage = 1;
        loadSubmissions();
      }, SEARCH_DEBOUNCE_MS);
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
      analyzingStartTimes.set(id, Date.now());
      ensureElapsedTicking();
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
          analyzingStartTimes.delete(id);
          analysisProgressCache.delete(id);
          render();
          return;
        }
      } finally {
        analyzingIds.delete(id);
        analyzingStartTimes.delete(id);
        analysisProgressCache.delete(id);
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
      draftingStartTimes.set(id, Date.now());
      ensureElapsedTicking();
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
          draftingStartTimes.delete(id);
          emailProgressCache.delete(id);
          render();
          return;
        }
      } finally {
        draftingIds.delete(id);
        draftingStartTimes.delete(id);
        emailProgressCache.delete(id);
        renderList();
      }
    });
  }

  function initAssetControls() {
    els.list.addEventListener("click", async (e) => {
      const viewBtn = e.target.closest(".submission-asset-view-btn[data-asset-path]");
      if (viewBtn) {
        const path = viewBtn.dataset.assetPath;
        const submissionId = Number(viewBtn.dataset.submissionId);
        const original = viewBtn.textContent;
        viewBtn.disabled = true;
        viewBtn.textContent = "Loading…";

        // Most browsers only allow window.open() to succeed when it's called
        // synchronously within the original click — once anything is awaited
        // first, it's silently blocked as a popup (returns null, doesn't
        // throw). Opening a blank tab right here, then redirecting it once
        // the signed URL resolves, keeps this inside the trusted-gesture window.
        const win = window.open("", "_blank", "noopener");

        try {
          const url = await getAssetSignedUrl(submissionId, path);
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
          viewBtn.disabled = false;
          viewBtn.textContent = original;
        }
        return;
      }

      const removeBtn = e.target.closest(".submission-asset-remove-btn[data-asset-path]");
      if (removeBtn) {
        const path = removeBtn.dataset.assetPath;
        const id = Number(removeBtn.dataset.submissionId);
        if (!window.confirm("Remove this file? This can't be undone.")) return;

        removeBtn.disabled = true;
        try {
          const updated = await deleteAsset(id, path);
          const idx = cachedSubmissions.findIndex((s) => s.id === id);
          if (idx !== -1) cachedSubmissions[idx] = { ...cachedSubmissions[idx], projectDetails: updated.projectDetails };
          renderList();
        } catch (err) {
          els.adminSub.textContent = err.message;
          removeBtn.disabled = false;
          if (!isAdminLoggedIn()) render();
        }
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

      // The price inputs have min="0", but nothing here ever calls
      // checkValidity() (there's no native <form>/submit — see
      // frontend/web-design.html's field markup pattern), so a typed
      // negative value would otherwise reach the server unchecked. The
      // server validates this too (adminController.upsertOutcome), but
      // catching it here avoids a pointless round trip.
      for (const [name, value] of [["quotedPrice", payload.quotedPrice], ["finalPrice", payload.finalPrice]]) {
        if (value !== null && (!Number.isFinite(value) || value < 0)) {
          msg.textContent = `${name === "quotedPrice" ? "Quoted price" : "Final price"} must be a non-negative number.`;
          return;
        }
      }

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

  function initDeleteControls() {
    els.list.addEventListener("click", async (e) => {
      const btn = e.target.closest(".submission-delete-btn[data-delete-id]");
      if (!btn) return;

      const id = Number(btn.dataset.deleteId);
      if (!window.confirm("Permanently delete this submission? This can't be undone.")) return;

      btn.disabled = true;
      try {
        await deleteSubmission(id);
        cachedSubmissions = cachedSubmissions.filter((s) => s.id !== id);
        paginationMeta = { ...paginationMeta, total: Math.max(0, paginationMeta.total - 1) };
        renderList();
      } catch (err) {
        els.adminSub.textContent = err.message;
        btn.disabled = false;
        if (!isAdminLoggedIn()) render();
      }
    });
  }

  // Tracks whether an Ollama start/stop request from this tab is in flight,
  // same pattern as analyzingIds/draftingIds — prevents a second click from
  // firing a duplicate request while one is still running.
  let ollamaActionInFlight = false;
  // Once a status check confirms the control helper isn't configured on
  // this server (503 from routes/admin.js), there's no point re-checking on
  // every render — the toggle just stays hidden for the rest of the session.
  let ollamaControlUnavailable = false;

  function setOllamaUi({ configured, running }) {
    if (!els.ollamaControl) return;
    if (!configured) {
      els.ollamaControl.hidden = true;
      return;
    }
    els.ollamaControl.hidden = false;
    els.ollamaDot.classList.toggle("is-running", running);
    els.ollamaDot.classList.toggle("is-stopped", !running);
    els.ollamaText.textContent = `Ollama: ${running ? "running" : "stopped"}`;
    els.ollamaToggleBtn.hidden = false;
    els.ollamaToggleBtn.textContent = running ? "Stop" : "Start";
    els.ollamaToggleBtn.dataset.running = running ? "true" : "false";
  }

  async function refreshOllamaStatus() {
    if (ollamaControlUnavailable || !els.ollamaControl || ollamaActionInFlight) return;
    try {
      const result = await getOllamaStatus();
      if (!result.configured) {
        ollamaControlUnavailable = true;
        setOllamaUi({ configured: false });
        return;
      }
      setOllamaUi({ configured: true, running: result.running });
    } catch (err) {
      // A transient failure (host asleep, Tailscale hiccup) shouldn't hide
      // the control or spam the admin — show it as an unknown/offline state
      // and let the next status poll or manual retry recover.
      if (els.ollamaControl) {
        els.ollamaControl.hidden = false;
        els.ollamaDot.classList.remove("is-running");
        els.ollamaDot.classList.add("is-stopped");
        els.ollamaText.textContent = "Ollama: unreachable";
        els.ollamaToggleBtn.hidden = true;
      }
      if (!isAdminLoggedIn()) render();
    }
  }

  function initOllamaControl() {
    if (!els.ollamaToggleBtn) return;
    els.ollamaToggleBtn.addEventListener("click", async () => {
      if (ollamaActionInFlight) return;
      const wasRunning = els.ollamaToggleBtn.dataset.running === "true";
      ollamaActionInFlight = true;
      els.ollamaToggleBtn.disabled = true;
      els.ollamaToggleBtn.textContent = wasRunning ? "Stopping…" : "Starting…";

      try {
        if (wasRunning) {
          await stopOllamaRemote();
        } else {
          await startOllamaRemote();
        }
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      } finally {
        // Cleared before the follow-up status check below, not after —
        // refreshOllamaStatus() itself bails out early while
        // ollamaActionInFlight is true (see its guard clause), so clearing
        // it only in a later .finally() here would make that check a
        // permanent no-op and leave the button stuck on "Starting…" /
        // "Stopping…" forever, even after a successful start/stop. Caught
        // by a real live test against the actual Mac control helper, not
        // by inspection.
        ollamaActionInFlight = false;
        els.ollamaToggleBtn.disabled = false;
      }
      await refreshOllamaStatus();
    });
  }

  // BrindLeaf Guardian's production diagnostics panel — same
  // fetch-on-load/refetch-after-action shape as
  // refreshOllamaStatus()/initOllamaControl() above, reporting a distinct
  // thing (overall app health via GET/POST /api/admin/guardian/*) rather
  // than duplicating that logic.
  function renderGuardianStatus(overall, lastCheckIso) {
    if (!els.guardianDot) return;
    els.guardianDot.classList.remove("is-healthy", "is-warning", "is-failed");
    const labelByStatus = { HEALTHY: "Healthy", WARNING: "Warning", FAILED: "Failed" };
    const classByStatus = { HEALTHY: "is-healthy", WARNING: "is-warning", FAILED: "is-failed" };
    if (classByStatus[overall]) els.guardianDot.classList.add(classByStatus[overall]);
    els.guardianText.textContent = `Guardian: ${labelByStatus[overall] || "Unknown"}`;
    els.guardianLastCheck.textContent = lastCheckIso ? `Last checked ${new Date(lastCheckIso).toLocaleString()}` : "";
  }

  function renderGuardianHistory(rows) {
    if (!els.guardianHistory) return;
    if (!rows || rows.length === 0) {
      els.guardianHistory.hidden = true;
      els.guardianHistory.innerHTML = "";
      return;
    }
    els.guardianHistory.hidden = false;
    els.guardianHistory.innerHTML = rows
      .map(
        (r) =>
          `<div class="guardian-history-item"><span class="guardian-history-time">${escapeHtml(new Date(r.createdAt).toLocaleString())}</span><span>${escapeHtml(r.status)} — ${escapeHtml(r.summary || "")}</span></div>`
      )
      .join("");
  }

  async function refreshGuardianPanel() {
    if (!els.guardianDot) return;
    try {
      const rows = await getGuardianHistory(5);
      renderGuardianHistory(rows);
      if (rows.length > 0) {
        renderGuardianStatus(rows[0].status, rows[0].createdAt);
        return;
      }
      // No history yet on this install — fall through to a live diagnostics
      // read so the panel isn't stuck on "checking…" forever before the
      // first "Run Guardian Check" click.
      const diagnostics = await getGuardianDiagnostics();
      renderGuardianStatus(diagnostics.overall, null);
    } catch (err) {
      els.guardianText.textContent = "Guardian: unavailable";
      els.guardianLastCheck.textContent = "";
    }
  }

  function initGuardianPanel() {
    if (!els.guardianRunBtn) return;
    els.guardianRunBtn.addEventListener("click", async () => {
      els.guardianRunBtn.disabled = true;
      const original = els.guardianRunBtn.textContent;
      els.guardianRunBtn.textContent = "Running…";
      try {
        const result = await runGuardianCheck();
        renderGuardianStatus(result.status, result.createdAt);
        const rows = await getGuardianHistory(5);
        renderGuardianHistory(rows);
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      } finally {
        els.guardianRunBtn.disabled = false;
        els.guardianRunBtn.textContent = original;
      }
    });
  }

  // BrindLeaf Guardian's AI safety control plane panel — the kill switch
  // UI. Disable/lockdown are one click each (still behind a native
  // confirm(), matching this file's existing pattern for consequential
  // actions — see the Remove/Delete/Finalize handlers elsewhere in this
  // file); re-enable is deliberately more involved: it shows why AI was
  // disabled before confirming, and if the server reports an
  // unacknowledged CRITICAL event is blocking it (409), that's surfaced
  // directly rather than as a generic error.
  function renderAiControlStatus(state) {
    if (!els.aiControlDot) return;
    els.aiControlDot.classList.remove("is-enabled", "is-disabled", "is-lockdown");
    const classByState = { ENABLED: "is-enabled", DISABLED: "is-disabled", LOCKDOWN: "is-lockdown" };
    if (classByState[state.state]) els.aiControlDot.classList.add(classByState[state.state]);
    els.aiControlText.textContent = `AI: ${state.state}`;
    els.aiControlReason.textContent = state.reason || "";

    const isEnabled = state.state === "ENABLED";
    els.aiDisableBtn.hidden = !isEnabled;
    els.aiLockdownBtn.hidden = !isEnabled;
    els.aiEnableBtn.hidden = isEnabled;
  }

  function renderSecurityEvents(events) {
    if (!els.securityEventsList) return;
    if (!events || events.length === 0) {
      els.securityEventsPanel.hidden = true;
      els.securityEventsList.innerHTML = "";
      return;
    }
    els.securityEventsPanel.hidden = false;
    els.securityEventsList.innerHTML = events
      .map((e) => {
        const sevClass = `sev-${e.severity.toLowerCase()}`;
        const ackBtn = !e.acknowledgedAt
          ? `<button class="btn btn-ghost security-event-ack-btn" data-event-id="${e.id}" type="button">Acknowledge</button>`
          : `<span class="security-event-time">acknowledged</span>`;
        return `<div class="security-event-item">
          <span class="security-event-severity ${sevClass}">${escapeHtml(e.severity)}</span>
          <span class="security-event-time">${escapeHtml(new Date(e.createdAt).toLocaleString())}</span>
          <span>${escapeHtml(e.eventType)} — ${escapeHtml(e.description || "")}</span>
          ${ackBtn}
        </div>`;
      })
      .join("");
  }

  async function refreshAiControlPanel() {
    if (!els.aiControlDot) return;
    try {
      const [state, events] = await Promise.all([getAiControlState(), getSecurityEvents(10)]);
      renderAiControlStatus(state);
      renderSecurityEvents(events);
    } catch (err) {
      els.aiControlText.textContent = "AI: unavailable";
      els.aiControlReason.textContent = "";
    }
  }

  function initAiControlPanel() {
    if (!els.aiDisableBtn) return;

    els.aiDisableBtn.addEventListener("click", async () => {
      if (!window.confirm("Disable all AI features? Every AI operation will be rejected until re-enabled.")) return;
      try {
        await disableAi("Disabled from the admin dashboard.");
        await refreshAiControlPanel();
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      }
    });

    els.aiLockdownBtn.addEventListener("click", async () => {
      if (!window.confirm("LOCK DOWN all AI features? This is the same state an automatic security incident would trigger, and re-enabling will require acknowledging it.")) return;
      try {
        await lockdownAi("Manually locked down from the admin dashboard.");
        await refreshAiControlPanel();
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      }
    });

    els.aiEnableBtn.addEventListener("click", async () => {
      const currentReason = els.aiControlReason.textContent;
      if (!window.confirm(`Re-enable AI?\n\nIt was disabled because: ${currentReason || "(no reason recorded)"}\n\nOnly do this once you're confident it's safe to resume.`)) return;
      try {
        await enableAi("Re-enabled from the admin dashboard.");
        await refreshAiControlPanel();
      } catch (err) {
        if (err.blockingEvent) {
          els.adminSub.textContent = `Cannot re-enable: acknowledge security event #${err.blockingEvent.id} (${err.blockingEvent.eventType}) first — see Recent Security Events below.`;
        } else {
          els.adminSub.textContent = err.message;
        }
        if (!isAdminLoggedIn()) render();
      }
    });

    els.securityEventsList.addEventListener("click", async (e) => {
      const btn = e.target.closest(".security-event-ack-btn[data-event-id]");
      if (!btn) return;
      const id = Number(btn.dataset.eventId);
      btn.disabled = true;
      try {
        await acknowledgeSecurityEvent(id);
        await refreshAiControlPanel();
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
        btn.disabled = false;
      }
    });
  }

  function initCleanupOrphans() {
    if (!els.cleanupBtn) return;
    els.cleanupBtn.addEventListener("click", async () => {
      const original = els.cleanupBtn.textContent;
      els.cleanupBtn.disabled = true;
      els.cleanupBtn.textContent = "Cleaning…";

      try {
        const result = await cleanupOrphanedAssets();
        els.adminSub.textContent =
          result.deleted > 0
            ? `Removed ${result.deleted} unused file${result.deleted === 1 ? "" : "s"} (scanned ${result.scanned}).`
            : `No unused files found (scanned ${result.scanned}).`;
      } catch (err) {
        els.adminSub.textContent = err.message;
        if (!isAdminLoggedIn()) render();
      } finally {
        els.cleanupBtn.disabled = false;
        els.cleanupBtn.textContent = original;
      }
    });
  }

  function initExport() {
    els.exportBtn.addEventListener("click", async () => {
      const original = els.exportBtn.textContent;
      els.exportBtn.disabled = true;
      els.exportBtn.textContent = "Exporting…";

      try {
        const { blob, filename } = await exportSubmissionsCsv(currentType, currentService, currentSearch);
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
    initSearch();
    initStatusControls();
    initAnalysisControls();
    initEmailDraftControls();
    initAssetControls();
    initOutcomeControls();
    initDeleteControls();
    initPagination();
    initExport();
    initCleanupOrphans();
    initOllamaControl();
    initGuardianPanel();
    initAiControlPanel();
    initContractCreation();

    els.btnLogin.addEventListener("click", () => openModal("login"));
    els.btnLogout.addEventListener("click", async () => {
      await requestServerLogout();
      logoutAdmin();
      render();
    });

    window.addEventListener("studio:admin-auth-change", render);
    // Fired by js/chat.js after "Save as new submission" (the AI chat
    // feature's standalone paste-and-analyze flow) — the new submission
    // exists in the DB now, but this list's own cache has no way to know
    // that on its own, since chat.js created it through a completely
    // separate request this list never saw.
    window.addEventListener("studio:submissions-changed", loadSubmissions);

    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
