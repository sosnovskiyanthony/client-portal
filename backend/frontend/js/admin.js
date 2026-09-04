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

  // "Add Context" state — all keyed by submission id, all module-level for
  // the same reason as analyzingIds above: renderList() rebuilds the whole
  // list's HTML on any unrelated change (a filter click, another card's
  // status update), so anything that needs to survive that has to live
  // here, not in transient DOM state (e.g. a native <details> element's
  // open/closed state would just be silently reset).
  const contextExpandedIds = new Set(); // panel expanded (and safe to lazy-load/render)
  const contextDataCache = new Map(); // id -> {currentContext, activeFacts, changeHistory, contextVersion}
  const contextInterpretingIds = new Set();
  const contextProposalCache = new Map(); // id -> {changeRecordId, result, changeState: [{approved, proposedValue, edited}], instruction}
  const contextApplyingIds = new Set();
  const contextReanalyzingIds = new Set();

  // Pricing & Offer Strategy state — same module-level-for-survival
  // reasoning as the context state above.
  const pricingDataCache = new Map(); // id -> {current, history} (submission_pricing_versions rows)
  const pricingFetchingIds = new Set(); // initial-load in flight, guards against re-fetching on every render before it resolves
  const pricingGeneratingIds = new Set();
  const pricingHistoryExpandedIds = new Set();

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

  // Comfortably above adminController.js's own STALE_PROCESSING_MS (10
  // minutes, itself with real margin over ollamaProvider.js's 8-minute
  // REQUEST_TIMEOUT_MS) — the backend should always resolve well before
  // this fires. Exists as a last-resort client-side net regardless, same
  // reasoning as chat.js's identical POLL_TIMEOUT_MS.
  const ANALYSIS_POLL_TIMEOUT_MS = 12 * 60 * 1000;

  // analyzeSubmission's POST now just kicks the run off (or confirms one
  // already in flight) and returns immediately — this is what actually
  // waits for the real, eventual result via getAnalysisProgress, separate
  // from tickElapsedLabels' own polling above (that one only ever updates
  // the live stage LABEL for display; this is what the click handler below
  // awaits for the final analysis record). Resolves with the analysis
  // record whether it completed or failed — runAnalysis() treats an AI
  // failure as a normal recorded outcome, not an exception, and this
  // preserves that same contract for the caller. Only rejects for a
  // genuine infrastructure problem: the run was abandoned server-side (a
  // restart mid-analysis) or this ceiling was reached with no answer.
  function pollForAnalysisOutcome(id) {
    const pollStartedAt = Date.now();
    return new Promise((resolve, reject) => {
      const handle = setInterval(async () => {
        if (Date.now() - pollStartedAt > ANALYSIS_POLL_TIMEOUT_MS) {
          clearInterval(handle);
          reject(new Error("Lost contact with the analysis — the server may have restarted. Try again."));
          return;
        }
        const progress = await getAnalysisProgress(id);
        if (!progress || !progress.done) return;
        clearInterval(handle);
        if (progress.analysis) {
          resolve(progress.analysis);
        } else {
          reject(new Error(progress.error || "Analysis failed."));
        }
      }, 1000);
    });
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
      // this window — ollamaProvider.js's own REQUEST_TIMEOUT_MS is 8
      // minutes. Past 10, the most likely explanation is the server
      // restarted mid-run and nothing is left running to ever finish it, so
      // offer a manual retry instead of leaving the admin stuck on "reload
      // to check". Mirrors adminController.js's STALE_PROCESSING_MS.
      const STUCK_THRESHOLD_MS = 10 * 60 * 1000;
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

        ${renderPricingSection(submission)}

        ${renderContextSection(submission)}

        ${renderEmailDraftSection(submission)}
      </div>
    `;
  }

  // ---- Pricing & Offer Strategy ----
  // Only ever rendered from renderAnalysisSection's completed branch —
  // pricing requires an existing completed analysis, same restriction the
  // server enforces in adminController.generatePricingStrategy. Every
  // number here is an advisory internal estimate, never a quote — see
  // ai/pricingSchema.js's own header comment.
  const BUDGET_ALIGNMENT_LABELS = {
    strongly_aligned: "Strongly aligned",
    reasonably_aligned: "Reasonably aligned",
    slight_mismatch: "Slight mismatch",
    significant_mismatch: "Significant mismatch",
    severe_mismatch: "Severe mismatch",
    unknown: "Unknown",
  };
  const BUDGET_CONFIDENCE_LABELS = { explicit: "Explicit", approximate: "Approximate", maximum: "Maximum", desired: "Desired", implied: "Implied", unknown: "Unknown" };
  const FEATURE_CLASSIFICATION_LABELS = { KEEP: "Keep", SIMPLIFY: "Simplify", DEFER: "Defer", REMOVE: "Remove" };

  function renderPricingDealCard(deal, isPrimary) {
    if (!deal) return "";
    return `
      <div class="pricing-deal-card ${isPrimary ? "pricing-deal-primary" : ""}">
        <div class="pricing-deal-header">
          <span class="pricing-deal-label">${escapeHtml(deal.label)}</span>
          <span class="pricing-deal-price">${escapeHtml(deal.price)}</span>
        </div>
        ${deal.includedScope && deal.includedScope.length ? `<div class="pricing-deal-block"><span class="pricing-deal-block-label">Includes</span>${renderStringList(deal.includedScope)}</div>` : ""}
        ${deal.deferredOrRemoved && deal.deferredOrRemoved.length ? `<div class="pricing-deal-block"><span class="pricing-deal-block-label">Deferred / not included</span>${renderStringList(deal.deferredOrRemoved)}</div>` : ""}
        ${deal.paymentStructure ? `<p class="pricing-deal-payment">${escapeHtml(deal.paymentStructure)}</p>` : ""}
        <p class="pricing-deal-reasoning">${escapeHtml(deal.reasoning)}</p>
      </div>
    `;
  }

  function renderPricingResult(r) {
    return `
      <div class="pricing-result">
        <div class="pricing-value-row">
          <div class="pricing-value-block">
            <span class="pricing-value-label">Project value (independent of budget)</span>
            <span class="pricing-value-figure">${escapeHtml(r.projectValueLow)} – ${escapeHtml(r.projectValueHigh)}</span>
            <p class="pricing-value-reasoning">${escapeHtml(r.projectValueReasoning)}</p>
          </div>
          <div class="pricing-value-block">
            <span class="pricing-value-label">Client budget</span>
            <span class="pricing-value-figure">${r.clientBudget ? escapeHtml(r.clientBudget) : "Not stated"}</span>
            <p class="pricing-value-reasoning">${escapeHtml(BUDGET_CONFIDENCE_LABELS[r.budgetConfidence] || r.budgetConfidence)} confidence</p>
          </div>
        </div>

        <div class="pricing-alignment-row">
          <span class="pricing-alignment-badge pricing-alignment-${escapeHtml(r.budgetAlignment)}">${escapeHtml(BUDGET_ALIGNMENT_LABELS[r.budgetAlignment] || r.budgetAlignment)}</span>
          <p class="pricing-value-reasoning">${escapeHtml(r.budgetAlignmentReasoning)}</p>
        </div>

        ${r.budgetTooLow ? `<div class="pricing-too-low-banner"><strong>Not commercially realistic as currently scoped.</strong> ${escapeHtml(r.budgetGapExplanation || "")}</div>` : ""}

        <div class="pricing-deal-grid">
          ${renderPricingDealCard(r.recommendedDeal, true)}
          ${renderPricingDealCard(r.alternativeDeal, false)}
          ${renderPricingDealCard(r.premiumDeal, false)}
        </div>

        ${
          r.featureClassification && r.featureClassification.length
            ? `<div class="analysis-block">
                <span class="analysis-block-label">Feature classification</span>
                <div class="pricing-feature-list">
                  ${r.featureClassification
                    .map(
                      (f) => `
                    <div class="pricing-feature-row">
                      <span class="pricing-feature-badge pricing-feature-${escapeHtml(f.classification.toLowerCase())}">${escapeHtml(FEATURE_CLASSIFICATION_LABELS[f.classification] || f.classification)}</span>
                      <span class="pricing-feature-name">${escapeHtml(f.feature)}</span>
                      <span class="pricing-feature-reasoning">${escapeHtml(f.reasoning)}</span>
                    </div>`
                    )
                    .join("")}
                </div>
              </div>`
            : ""
        }

        ${
          r.recurringServiceOpportunities && r.recurringServiceOpportunities.length
            ? `<div class="analysis-block"><span class="analysis-block-label">Recurring service opportunities</span>${renderStringList(r.recurringServiceOpportunities)}</div>`
            : ""
        }

        <div class="analysis-block">
          <span class="analysis-block-label">Closing strategy</span>
          <p class="analysis-block-text">${escapeHtml(r.closingStrategy)}</p>
        </div>

        ${r.risks && r.risks.length ? `<div class="analysis-block"><span class="analysis-block-label">Pricing risks</span>${renderStringList(r.risks)}</div>` : ""}

        <details class="analysis-raw">
          <summary>Reasoning</summary>
          ${renderStringList(r.reasoning, "No reasoning was returned.")}
        </details>
      </div>
    `;
  }

  function renderPricingHistoryToggle(submission, history) {
    if (history.length <= 1) return "";
    const expanded = pricingHistoryExpandedIds.has(submission.id);
    return `
      <button class="pricing-history-toggle-btn" data-pricing-history-toggle-id="${submission.id}" type="button">${expanded ? "Hide" : "Show"} pricing history (${history.length} versions)</button>
      ${
        expanded
          ? `<div class="context-history-list">
              ${history
                .map(
                  (v) => `
                <div class="context-history-item">
                  <span class="context-history-time">${escapeHtml(new Date(v.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</span>
                  <span class="context-history-status context-history-status-${v.status === "completed" ? "applied" : v.status === "failed" ? "rejected" : ""}">v${v.versionNumber} · ${escapeHtml(v.status)}</span>
                  <p class="context-history-instruction">${v.status === "completed" && v.result && v.result.recommendedDeal ? escapeHtml(`Recommended: ${v.result.recommendedDeal.price}`) : escapeHtml(v.error || "—")}</p>
                </div>`
                )
                .join("")}
            </div>`
          : ""
      }
    `;
  }

  function renderPricingSection(submission) {
    const a = submission.analysis;
    if (!a || a.status !== "completed") return ""; // matches the server precondition — nothing to price yet
    const id = submission.id;

    if (!pricingDataCache.has(id) && !pricingFetchingIds.has(id)) {
      pricingFetchingIds.add(id);
      getPricingHistory(id)
        .then((data) => {
          pricingDataCache.set(id, data);
        })
        .catch((err) => {
          pricingDataCache.set(id, { current: null, history: [], loadError: err.message });
        })
        .finally(() => {
          pricingFetchingIds.delete(id);
          renderList();
        });
    }

    const cached = pricingDataCache.get(id);
    const generating = pricingGeneratingIds.has(id);
    const current = cached ? cached.current : null;
    const history = cached ? cached.history : [];
    const isStale = current && current.status === "completed" && typeof current.contextVersion === "number" && typeof submission.contextVersion === "number" && current.contextVersion < submission.contextVersion;

    let body;
    if (!cached) {
      body = `<p class="analysis-empty">Loading…</p>`;
    } else if (generating || (current && (current.status === "pending" || current.status === "processing"))) {
      body = `<button class="btn btn-ghost pricing-generate-btn" type="button" disabled>Generating…</button>`;
    } else if (!current) {
      body = `
        <p class="analysis-empty">No pricing strategy generated yet.</p>
        <button class="btn btn-primary pricing-generate-btn" data-pricing-id="${id}" type="button">Generate Pricing Strategy</button>
      `;
    } else if (current.status === "failed") {
      body = `
        <p class="analysis-error">${escapeHtml(current.error || "Pricing generation failed.")}</p>
        <button class="btn btn-ghost pricing-generate-btn" data-pricing-id="${id}" type="button">Retry</button>
      `;
    } else {
      body = `
        ${isStale ? `<span class="context-stale-badge">Stale — context has changed since this was generated</span>` : ""}
        ${renderPricingResult(current.result)}
        <p class="analysis-meta">${escapeHtml(current.provider || "")} · ${escapeHtml(current.model || "")} · v${current.versionNumber} · prompt v${escapeHtml(current.promptVersion || "")}</p>
        <button class="btn btn-ghost pricing-generate-btn" data-pricing-id="${id}" type="button">Recalculate Pricing</button>
        ${renderPricingHistoryToggle(submission, history)}
      `;
    }

    return `
      <div class="analysis-section pricing-section">
        <div class="analysis-header">
          <span class="analysis-title">Pricing &amp; Offer Strategy</span>
        </div>
        ${body}
      </div>
    `;
  }

  const PRICING_POLL_TIMEOUT_MS = 12 * 60 * 1000;

  function pollForPricingOutcome(id) {
    const pollStartedAt = Date.now();
    return new Promise((resolve, reject) => {
      const handle = setInterval(async () => {
        if (Date.now() - pollStartedAt > PRICING_POLL_TIMEOUT_MS) {
          clearInterval(handle);
          reject(new Error("Lost contact with the pricing generation — the server may have restarted. Try again."));
          return;
        }
        const progress = await getPricingProgress(id);
        if (!progress || !progress.done) return;
        clearInterval(handle);
        if (progress.ok) resolve(progress.pricingVersion);
        else reject(Object.assign(new Error(progress.error || "Pricing generation failed."), { code: progress.code }));
      }, 1000);
    });
  }

  function initPricingControls() {
    els.list.addEventListener("click", async (e) => {
      const generateBtn = e.target.closest(".pricing-generate-btn[data-pricing-id]");
      if (generateBtn) {
        const id = Number(generateBtn.dataset.pricingId);
        if (pricingGeneratingIds.has(id)) return;

        pricingGeneratingIds.add(id);
        renderList();

        try {
          await startPricingGeneration(id);
          const pricingVersion = await pollForPricingOutcome(id);
          const cached = pricingDataCache.get(id) || { history: [] };
          pricingDataCache.set(id, { current: pricingVersion, history: [pricingVersion, ...cached.history.filter((v) => v.id !== pricingVersion.id)] });
        } catch (err) {
          els.adminSub.textContent = err.message;
          const cached = pricingDataCache.get(id) || { history: [] };
          pricingDataCache.set(id, { current: { status: "failed", error: err.message }, history: cached.history });
        } finally {
          pricingGeneratingIds.delete(id);
          renderList();
        }
        return;
      }

      const historyToggleBtn = e.target.closest(".pricing-history-toggle-btn[data-pricing-history-toggle-id]");
      if (historyToggleBtn) {
        const id = Number(historyToggleBtn.dataset.pricingHistoryToggleId);
        if (pricingHistoryExpandedIds.has(id)) pricingHistoryExpandedIds.delete(id);
        else pricingHistoryExpandedIds.add(id);
        renderList();
      }
    });
  }

  // ---- "Add Context" — project intelligence ----
  // Only ever rendered from renderAnalysisSection's completed branch above
  // — recalculating context requires an existing completed analysis to
  // revise, same restriction the server enforces in
  // adminController.interpretSubmissionContext.
  const CONTEXT_CHANGE_TYPE_LABELS = { ADD: "Add", MODIFY: "Modify", REMOVE: "Remove" };

  function renderContextChangeCard(change, i, state) {
    const isAdd = change.action === "ADD";
    const isRemove = change.action === "REMOVE";
    return `
      <div class="edit-change-card ${state.approved ? "edit-change-approved" : "edit-change-rejected"}" data-change-index="${i}">
        <div class="edit-change-header">
          <label class="edit-change-checkbox">
            <input type="checkbox" class="context-change-approve-toggle" data-index="${i}" ${state.approved ? "checked" : ""} />
            <span>Approve</span>
          </label>
          <span class="edit-change-type edit-change-type-${change.action.toLowerCase()}">${escapeHtml(CONTEXT_CHANGE_TYPE_LABELS[change.action] || change.action)}</span>
          <span class="edit-change-section-title">${escapeHtml(change.category)} / ${escapeHtml(change.field)}</span>
          <span class="edit-change-confidence edit-change-confidence-${escapeHtml(change.confidence)}">${escapeHtml(change.confidence)} confidence</span>
        </div>
        <p class="edit-change-rationale">${escapeHtml(change.reasoning)}</p>
        <div class="edit-change-diff">
          ${!isAdd ? `<div class="edit-diff-before"><span class="edit-diff-label">Current</span><pre class="edit-diff-text">${escapeHtml(change.previousValue || "")}</pre></div>` : ""}
          ${
            !isRemove
              ? `<div class="edit-diff-after"><span class="edit-diff-label" data-proposed-label="${i}">${isAdd ? "New value" : "Proposed"}${state.edited ? " (edited by you)" : ""}</span><textarea class="context-change-proposed-text" data-index="${i}" rows="2">${escapeHtml(state.proposedValue || "")}</textarea></div>`
              : ""
          }
        </div>
      </div>
    `;
  }

  function contextApprovedCount(id) {
    const proposal = contextProposalCache.get(id);
    return proposal ? proposal.changeState.filter((s) => s.approved).length : 0;
  }

  function renderContextProposal(submission) {
    const proposal = contextProposalCache.get(submission.id);
    if (!proposal) return "";

    if (proposal.result.clarificationNeeded) {
      return `
        <div class="edit-proposal edit-proposal-clarification">
          <p class="edit-proposal-summary">${escapeHtml(proposal.result.interpretation)}</p>
          <p class="contract-section-footnote">This needs more detail before it can become a real change:</p>
          <p class="edit-change-rationale">${escapeHtml(proposal.result.clarificationQuestion || "")}</p>
        </div>
      `;
    }
    if (proposal.result.proposedChanges.length === 0) {
      return `<p class="analysis-empty">No specific changes were proposed for that note.</p>`;
    }

    const approvedCount = contextApprovedCount(submission.id);
    return `
      <div class="edit-proposal">
        <p class="edit-proposal-summary">${escapeHtml(proposal.result.interpretation)}</p>
        <div class="edit-proposal-controls">
          <span id="context-approved-count-${submission.id}">${approvedCount} of ${proposal.changeState.length} approved</span>
          <button class="btn btn-ghost btn-small context-approve-all-btn" type="button">Approve All</button>
          <button class="btn btn-ghost btn-small context-reject-all-btn" type="button">Reject All</button>
        </div>
        <div class="context-change-cards">
          ${proposal.result.proposedChanges.map((c, i) => renderContextChangeCard(c, i, proposal.changeState[i])).join("")}
        </div>
        <button class="btn btn-primary context-apply-btn" data-context-id="${submission.id}" type="button" ${approvedCount === 0 || contextApplyingIds.has(submission.id) ? "disabled" : ""}>${contextApplyingIds.has(submission.id) ? "Applying…" : "Apply Approved Changes"}</button>
        <div class="context-apply-error" id="context-apply-error-${submission.id}"></div>
      </div>
    `;
  }

  const CONTEXT_SOURCE_LABEL = { admin_context: "Admin-added" };

  function renderContextPanel(submission) {
    const cached = contextDataCache.get(submission.id);
    if (!cached) return `<p class="analysis-empty">Loading…</p>`;

    const factsHtml = cached.activeFacts.length
      ? `<div class="context-fact-list">
          ${cached.activeFacts
            .map(
              (f) => `
            <div class="context-fact">
              <span class="context-fact-field">${escapeHtml(f.category)} / ${escapeHtml(f.field)}</span>
              <span class="context-fact-value">${escapeHtml(f.value || "")}</span>
              <span class="context-fact-source">${escapeHtml(CONTEXT_SOURCE_LABEL[f.source] || f.source)}${f.confidence ? ` · ${escapeHtml(f.confidence)} confidence` : ""}</span>
            </div>`
            )
            .join("")}
        </div>`
      : `<p class="analysis-empty">No admin-added context yet — everything below is straight from the client's own submission.</p>`;

    const historyHtml = cached.changeHistory.length
      ? `<div class="context-history-list">
          ${cached.changeHistory
            .map(
              (h) => `
            <div class="context-history-item">
              <span class="context-history-time">${escapeHtml(new Date(h.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }))}</span>
              <span class="context-history-status context-history-status-${escapeHtml(h.status)}">${escapeHtml(h.status.replace("_", " "))}</span>
              <p class="context-history-instruction">"${escapeHtml(h.rawInstruction)}"</p>
            </div>`
            )
            .join("")}
        </div>`
      : `<p class="analysis-empty">No context has been added yet.</p>`;

    return `
      <div class="context-panel">
        <h4 class="context-panel-heading">Project Context (v${cached.contextVersion})</h4>
        ${factsHtml}
        <h4 class="context-panel-heading">Context History</h4>
        ${historyHtml}
      </div>
    `;
  }

  function renderContextSection(submission) {
    const expanded = contextExpandedIds.has(submission.id);
    const a = submission.analysis;
    const cached = contextDataCache.get(submission.id);
    const isStale = a && cached && typeof a.contextVersion === "number" && a.contextVersion < cached.contextVersion;
    const interpreting = contextInterpretingIds.has(submission.id);
    const reanalyzing = contextReanalyzingIds.has(submission.id);

    return `
      <div class="context-section">
        <button class="context-toggle-btn" data-context-toggle-id="${submission.id}" type="button" aria-expanded="${expanded}">
          <span class="context-title">Add Context</span>
          ${isStale ? '<span class="context-stale-badge">Stale — recalculating</span>' : ""}
          <span class="context-toggle-icon" aria-hidden="true">${expanded ? "−" : "+"}</span>
        </button>
        ${
          expanded
            ? `
          <div class="context-body">
            ${renderContextPanel(submission)}
            ${
              reanalyzing
                ? `<p class="analysis-empty">Recalculating analysis from the new context…</p>`
                : ""
            }
            <label class="context-add-label" for="context-input-${submission.id}">Tell the AI anything you learned about this project…</label>
            <textarea class="context-add-input" id="context-input-${submission.id}" data-context-input-id="${submission.id}" rows="3" placeholder="e.g. &quot;They have a $12k budget&quot; or &quot;They want us to manage the site after launch.&quot;" ${interpreting ? "disabled" : ""}></textarea>
            <button class="btn btn-primary context-interpret-btn" data-context-id="${submission.id}" type="button" ${interpreting ? "disabled" : ""}>${interpreting ? "Interpreting…" : "Interpret"}</button>
            <div class="context-interpret-error" id="context-interpret-error-${submission.id}"></div>
            <div class="context-proposal-container">${renderContextProposal(submission)}</div>
          </div>
        `
            : ""
        }
      </div>
    `;
  }

  function refreshContextData(id) {
    return getSubmissionContext(id).then((data) => {
      contextDataCache.set(id, data);
    });
  }

  function initContextControls() {
    els.list.addEventListener("click", async (e) => {
      const toggleBtn = e.target.closest(".context-toggle-btn[data-context-toggle-id]");
      if (toggleBtn) {
        const id = Number(toggleBtn.dataset.contextToggleId);
        if (contextExpandedIds.has(id)) {
          contextExpandedIds.delete(id);
          renderList();
          return;
        }
        contextExpandedIds.add(id);
        if (!contextDataCache.has(id)) {
          renderList(); // show "Loading…" immediately
          try {
            await refreshContextData(id);
          } catch (err) {
            els.adminSub.textContent = err.message;
          }
        }
        renderList();
        return;
      }

      const interpretBtn = e.target.closest(".context-interpret-btn[data-context-id]");
      if (interpretBtn) {
        const id = Number(interpretBtn.dataset.contextId);
        const input = document.getElementById(`context-input-${id}`);
        const instruction = input ? input.value.trim() : "";
        if (!instruction || contextInterpretingIds.has(id)) return;

        contextInterpretingIds.add(id);
        contextProposalCache.delete(id);
        renderList();

        try {
          await startContextInterpretation(id, instruction);
          const proposalOutcome = await pollForContextInterpretOutcome(id);
          if (proposalOutcome.result.clarificationNeeded || proposalOutcome.result.proposedChanges.length > 0) {
            contextProposalCache.set(id, {
              changeRecordId: proposalOutcome.changeRecord ? proposalOutcome.changeRecord.id : null,
              result: proposalOutcome.result,
              changeState: proposalOutcome.result.proposedChanges.map((c) => ({ approved: true, proposedValue: c.proposedValue || "", edited: false })),
              instruction: proposalOutcome.instruction,
            });
          }
        } catch (err) {
          const errEl = document.getElementById(`context-interpret-error-${id}`);
          if (errEl) errEl.innerHTML = `<p class="edit-error-text">${escapeHtml(err.message)}</p>`;
        } finally {
          contextInterpretingIds.delete(id);
          renderList();
        }
        return;
      }

      const approveAllBtn = e.target.closest(".context-approve-all-btn");
      if (approveAllBtn) {
        const id = findContextIdFromButton(approveAllBtn);
        const proposal = contextProposalCache.get(id);
        if (proposal) {
          proposal.changeState.forEach((s) => (s.approved = true));
          renderList();
        }
        return;
      }

      const rejectAllBtn = e.target.closest(".context-reject-all-btn");
      if (rejectAllBtn) {
        const id = findContextIdFromButton(rejectAllBtn);
        const proposal = contextProposalCache.get(id);
        if (proposal) {
          proposal.changeState.forEach((s) => (s.approved = false));
          renderList();
        }
        return;
      }

      const applyBtn = e.target.closest(".context-apply-btn[data-context-id]");
      if (applyBtn) {
        const id = Number(applyBtn.dataset.contextId);
        const proposal = contextProposalCache.get(id);
        if (!proposal || contextApplyingIds.has(id)) return;

        contextApplyingIds.add(id);
        renderList();

        const approvedChanges = [];
        const rejectedChanges = [];
        proposal.result.proposedChanges.forEach((c, i) => {
          const state = proposal.changeState[i];
          const finalChange = { ...c, proposedValue: state.proposedValue };
          if (state.approved) approvedChanges.push(finalChange);
          else rejectedChanges.push(finalChange);
        });

        try {
          const result = await applyContextChanges(id, { changeRecordId: proposal.changeRecordId, changes: approvedChanges, rejectedChanges });
          contextProposalCache.delete(id);
          const idx = cachedSubmissions.findIndex((s) => s.id === id);
          if (idx !== -1) cachedSubmissions[idx] = { ...cachedSubmissions[idx], ...result.submission };
          await refreshContextData(id);

          if (result.reanalysisTriggered) {
            contextReanalyzingIds.add(id);
            renderList();
            try {
              const analysis = await pollForContextReanalysisOutcome(id);
              const idx2 = cachedSubmissions.findIndex((s) => s.id === id);
              if (idx2 !== -1) cachedSubmissions[idx2] = { ...cachedSubmissions[idx2], analysis };
              els.adminSub.textContent = `Analysis recalculated for ${cachedSubmissions[idx2] ? cachedSubmissions[idx2].clientName : "submission"}.`;

              // Pricing is chained server-side right after a successful
              // reanalysis (see services/runContextReanalysis.js) — poll
              // its own progress kind too so the Pricing & Offer Strategy
              // section picks up the fresh recommendation automatically,
              // instead of silently keeping the stale-badge state forever
              // until the admin happens to click something.
              pricingGeneratingIds.add(id);
              renderList();
              try {
                const pricingVersion = await pollForPricingOutcome(id);
                const cachedPricing = pricingDataCache.get(id) || { history: [] };
                pricingDataCache.set(id, { current: pricingVersion, history: [pricingVersion, ...cachedPricing.history.filter((v) => v.id !== pricingVersion.id)] });
              } catch (err) {
                // A pricing failure here is real but secondary to the
                // reanalysis outcome already reported above — surface it
                // without overwriting that message.
                console.error(`Pricing recalculation failed for submission ${id}:`, err.message);
              } finally {
                pricingGeneratingIds.delete(id);
              }
            } catch (err) {
              els.adminSub.textContent = err.message;
            } finally {
              contextReanalyzingIds.delete(id);
            }
          }
        } catch (err) {
          const errEl = document.getElementById(`context-apply-error-${id}`);
          if (errEl) errEl.innerHTML = `<p class="edit-error-text">${escapeHtml(err.message)}</p>`;
        } finally {
          contextApplyingIds.delete(id);
          renderList();
        }
        return;
      }
    });

    els.list.addEventListener("change", (e) => {
      const toggle = e.target.closest(".context-change-approve-toggle[data-index]");
      if (!toggle) return;
      const id = findContextIdFromButton(toggle);
      const proposal = contextProposalCache.get(id);
      if (!proposal) return;
      const i = Number(toggle.dataset.index);
      proposal.changeState[i].approved = toggle.checked;
      renderList();
    });

    els.list.addEventListener("input", (e) => {
      const textarea = e.target.closest(".context-change-proposed-text[data-index]");
      if (!textarea) return;
      const id = findContextIdFromButton(textarea);
      const proposal = contextProposalCache.get(id);
      if (!proposal) return;
      const i = Number(textarea.dataset.index);
      proposal.changeState[i].proposedValue = textarea.value;
      proposal.changeState[i].edited = textarea.value !== (proposal.result.proposedChanges[i].proposedValue || "");
      // Update just the label in place — re-rendering here would blow away
      // the textarea's cursor position mid-keystroke, same reasoning as
      // contracts.js's identical pattern for the AI Agreement Editor.
      const label = document.querySelector(`.context-change-cards [data-proposed-label="${i}"]`);
      if (label) {
        const isAdd = proposal.result.proposedChanges[i].action === "ADD";
        label.textContent = `${isAdd ? "New value" : "Proposed"}${proposal.changeState[i].edited ? " (edited by you)" : ""}`;
      }
    });
  }

  // Any control inside a submission card's context section can find its
  // own submission id via the closest .context-section's toggle button —
  // avoids re-threading data-context-id onto every single nested control.
  function findContextIdFromButton(el) {
    const section = el.closest(".context-section");
    const toggle = section ? section.querySelector("[data-context-toggle-id]") : null;
    return toggle ? Number(toggle.dataset.contextToggleId) : null;
  }

  const CONTEXT_POLL_TIMEOUT_MS = 12 * 60 * 1000; // same ceiling reasoning as ANALYSIS_POLL_TIMEOUT_MS above

  function pollForContextInterpretOutcome(id) {
    const pollStartedAt = Date.now();
    return new Promise((resolve, reject) => {
      const handle = setInterval(async () => {
        if (Date.now() - pollStartedAt > CONTEXT_POLL_TIMEOUT_MS) {
          clearInterval(handle);
          reject(new Error("Lost contact with the interpretation — the server may have restarted. Try again."));
          return;
        }
        const progress = await getContextInterpretProgress(id);
        if (!progress || !progress.done) return;
        clearInterval(handle);
        if (progress.ok) resolve(progress);
        else reject(Object.assign(new Error(progress.error || "Interpretation failed."), { code: progress.code }));
      }, 1000);
    });
  }

  function pollForContextReanalysisOutcome(id) {
    const pollStartedAt = Date.now();
    return new Promise((resolve, reject) => {
      const handle = setInterval(async () => {
        if (Date.now() - pollStartedAt > CONTEXT_POLL_TIMEOUT_MS) {
          clearInterval(handle);
          reject(new Error("Lost contact with the recalculation — the server may have restarted. The previous analysis is still shown."));
          return;
        }
        const progress = await getContextReanalysisProgress(id);
        if (!progress || !progress.done) return;
        clearInterval(handle);
        if (progress.ok) resolve(progress.analysis);
        else reject(Object.assign(new Error(progress.error || "Recalculating the analysis failed. The previous analysis is still shown above."), { code: progress.code }));
      }, 1000);
    });
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

        ${
          d.textMessage
            ? `<div class="email-draft-text-message">
                <span class="email-draft-block-label">Accompanying Text Message</span>
                <p class="email-draft-text-message-body">${escapeHtml(d.textMessage)}</p>
                <div class="email-draft-actions">
                  <button class="btn btn-ghost email-draft-copy-text-btn" data-copy-text-id="${submission.id}" type="button">Copy Text</button>
                  <span class="email-draft-copy-msg" aria-live="polite"></span>
                </div>
              </div>`
            : ""
        }

        ${
          d.internalAnalysisMarkdown
            ? `<details class="analysis-raw email-draft-internal-analysis">
                <summary>Internal Analysis (admin-only — never sent to the client)</summary>
                <pre>${escapeHtml(d.internalAnalysisMarkdown)}</pre>
              </details>`
            : ""
        }
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
        await analyzeSubmission(id);
        const updated = await pollForAnalysisOutcome(id);
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

      const copyTextBtn = e.target.closest(".email-draft-copy-text-btn[data-copy-text-id]");
      if (copyTextBtn) {
        const id = Number(copyTextBtn.dataset.copyTextId);
        const submission = cachedSubmissions.find((s) => s.id === id);
        const draft = submission && submission.emailDraft;
        const msg = copyTextBtn.closest(".email-draft-actions").querySelector(".email-draft-copy-msg");
        if (!draft || !draft.textMessage) return;

        try {
          await navigator.clipboard.writeText(draft.textMessage);
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
    initContextControls();
    initPricingControls();
    initAssetControls();
    initOutcomeControls();
    initDeleteControls();
    initPagination();
    initExport();
    initCleanupOrphans();
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
