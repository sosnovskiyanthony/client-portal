(() => {
  // Mirrors backend/lib/services.js — see common.js's SERVICE_SLUGS/
  // SERVICE_LABELS for why this is duplicated, not shared. Canonical order:
  // also the fixed step order once services are selected, regardless of
  // the order they were clicked in — a predictable flow, not click-order
  // dependent.
  const SERVICE_DATA_KEYS = {
    "web-design": "webDesign",
    seo: "seo",
    "ai-integration": "aiIntegration",
    "app-building": "appBuilding",
    "web-management": "webManagement",
  };

  // Mirrors REQUIRED_SERVICE_FIELDS in controllers/intakeController.js —
  // client-side gating only; the server independently re-validates the
  // same requirements regardless of what this does.
  const REQUIRED_SERVICE_FIELDS = {
    "web-design": ["goal", "summary", "brandStatus", "features", "contentReadiness", "timeline"],
    seo: ["url", "keywords", "challenge", "visibility"],
    "ai-integration": ["aiGoal", "businessProblem"],
    "app-building": ["appGoal", "coreWorkflows"],
    "web-management": ["existingUrl", "helpNeeded"],
  };

  const state = {
    data: {
      services: [],
      name: "",
      email: "",
      webDesign: { goal: null, summary: "", brandStatus: null, features: [], contentReadiness: null, timeline: null },
      seo: { url: "", keywords: "", challenge: null, visibility: null },
      aiIntegration: { aiGoal: "", businessProblem: "", currentProcess: "", hasExistingAi: null, dataInvolved: "", integrations: "" },
      appBuilding: { appGoal: "", coreWorkflows: "", userType: null, requiredFeatures: "", dataToStore: "", integrations: "" },
      webManagement: { existingUrl: "", helpNeeded: "", engagementType: null, currentHosting: "", concerns: "" },
    },
    currentPanel: "select-services",
  };

  const DRAFT_KEY = "services";

  const els = {
    layout: document.getElementById("layout"),
    sectionNav: document.getElementById("section-nav"),
    stepContent: document.getElementById("step-content"),
    summaryList: document.getElementById("summary-list"),
    btnSubmit: document.getElementById("btn-submit"),
    submitHint: document.getElementById("submit-hint"),
    successState: document.getElementById("success-state"),
    successSub: document.getElementById("success-sub"),
    successSummary: document.getElementById("success-summary"),
  };

  const PANEL_LABELS = {
    "select-services": "Services",
    "web-design": "Web Design",
    seo: "SEO",
    "ai-integration": "AI Integration",
    "app-building": "App Building",
    "web-management": "Web Management",
    contact: "Contact",
  };

  // ---------- Path helpers ----------
  // data-field values here are dotted ("webDesign.goal") or bare
  // ("services") — a plain TEXT_BINDINGS list (the pattern web-design.js/
  // seo.js use) doesn't fit a field set that changes based on selection, so
  // this reads/writes state.data by path instead.
  function getPath(path) {
    return path.split(".").reduce((obj, key) => (obj == null ? obj : obj[key]), state.data);
  }
  function setPath(path, value) {
    const parts = path.split(".");
    const last = parts.pop();
    const target = parts.reduce((obj, key) => obj[key], state.data);
    target[last] = value;
  }

  function isMissing(value) {
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim().length === 0;
    return value === undefined || value === null;
  }

  // ---------- Dynamic step list ----------
  function activeSteps() {
    const serviceSteps = SERVICE_SLUGS.filter((s) => state.data.services.includes(s));
    return ["select-services", ...serviceSteps, "contact"];
  }

  function isPanelComplete(panelKey) {
    if (panelKey === "select-services") return state.data.services.length > 0;
    if (panelKey === "contact") {
      return state.data.name.trim().length > 0 && /\S+@\S+\.\S+/.test(state.data.email);
    }
    const dataKey = SERVICE_DATA_KEYS[panelKey];
    if (!dataKey) return true;
    const required = REQUIRED_SERVICE_FIELDS[panelKey] || [];
    return required.every((field) => !isMissing(state.data[dataKey][field]));
  }

  function isAllComplete() {
    return activeSteps().every(isPanelComplete);
  }

  // ---------- Section nav (dynamic tabs) ----------
  function renderSectionNav() {
    const steps = activeSteps();
    els.sectionNav.innerHTML = steps
      .map(
        (key) => `
        <button class="nav-tab ${key === state.currentPanel ? "active" : ""}" data-panel-goto="${key}" type="button">
          <span class="nav-tab-dot"></span>
          <span class="nav-tab-label">${escapeHtml(PANEL_LABELS[key] || key)}</span>
        </button>
      `
      )
      .join("");
    els.sectionNav.querySelectorAll(".nav-tab-dot").forEach((dot, i) => {
      const key = steps[i];
      dot.classList.toggle("complete", isPanelComplete(key));
    });
    els.sectionNav.querySelectorAll("[data-panel-goto]").forEach((btn) => {
      btn.addEventListener("click", () => goToPanel(btn.dataset.panelGoto));
    });
  }

  // ---------- Panel navigation ----------
  // Same crossfade/height-transition mechanics as common.js's
  // createSectionNavigator, but keyed by a string panel id instead of a
  // fixed 1..N step number — that helper assumes a fixed total section
  // count set once at construction, which doesn't fit a step list that
  // changes size every time a service gets checked/unchecked.
  let transitioning = false;
  function panelFor(key) {
    return document.querySelector(`.step-panel[data-panel="${key}"]`);
  }

  function goToPanel(key) {
    if (transitioning || key === state.currentPanel) return;
    const oldPanel = panelFor(state.currentPanel);
    const newPanel = panelFor(key);
    if (!newPanel) return;
    transitioning = true;

    const container = els.stepContent;
    container.style.height = `${container.offsetHeight}px`;
    void container.offsetHeight;

    newPanel.classList.add("measuring");
    const targetHeight = newPanel.scrollHeight;
    newPanel.classList.remove("measuring");

    oldPanel.classList.remove("active");
    oldPanel.classList.add("leaving");

    newPanel.classList.add("visible");
    container.style.height = `${targetHeight}px`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => newPanel.classList.add("active"));
    });

    window.setTimeout(() => {
      oldPanel.classList.remove("visible", "leaving");
    }, 420);

    window.setTimeout(() => {
      container.style.height = "auto";
      transitioning = false;
    }, 520);

    state.currentPanel = key;
    renderSectionNav();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goToNextPanel() {
    const steps = activeSteps();
    const idx = steps.indexOf(state.currentPanel);
    if (idx === -1 || idx === steps.length - 1) return;
    goToPanel(steps[idx + 1]);
  }

  // Every "Continue" button in the markup uses a static data-goto="__next__"
  // placeholder rather than a real panel key, since which panel comes next
  // depends on the current selection, not something fixed in the HTML.
  function initSectionContinue() {
    document.querySelectorAll(".section-continue[data-goto]").forEach((btn) => {
      btn.addEventListener("click", goToNextPanel);
    });
  }

  // If the current panel's service got deselected mid-flow, the current
  // panel is no longer in the active list — snap back to the start rather
  // than leaving the admin-visible flow on a hidden panel.
  function ensureCurrentPanelStillValid() {
    if (!activeSteps().includes(state.currentPanel)) {
      state.currentPanel = "select-services";
      document.querySelectorAll(".step-panel").forEach((p) => p.classList.remove("visible", "active", "leaving"));
      const panel = panelFor("select-services");
      panel.classList.add("visible", "active");
    }
  }

  // ---------- Selectors (multi/single pill & card toggles) ----------
  function initSelectors() {
    document.querySelectorAll("[data-field]").forEach((group) => {
      if (!group.classList.contains("toggle-grid") && !group.classList.contains("pill-row")) return;
      const field = group.dataset.field;
      const mode = group.dataset.mode;
      const selector = group.classList.contains("pill-row") ? ".pill" : ".bento-card";

      group.addEventListener("click", (e) => {
        const item = e.target.closest(selector);
        if (!item) return;
        const value = item.dataset.value;

        if (mode === "single") {
          group.querySelectorAll(selector).forEach((c) => {
            c.classList.remove("selected");
            c.setAttribute("aria-pressed", "false");
          });
          item.classList.add("selected");
          item.setAttribute("aria-pressed", "true");
          setPath(field, value);
        } else {
          item.classList.toggle("selected");
          item.setAttribute("aria-pressed", String(item.classList.contains("selected")));
          const list = getPath(field);
          const idx = list.indexOf(value);
          if (item.classList.contains("selected") && idx === -1) list.push(value);
          if (!item.classList.contains("selected") && idx !== -1) list.splice(idx, 1);
        }

        if (field === "services") {
          renderSectionNav();
          ensureCurrentPanelStillValid();
        }
        renderSummary();
        renderSectionNav();
        updateSubmitState();
        saveDraft(DRAFT_KEY, state.data);
      });
    });
  }

  // ---------- Text inputs (dotted data-field, dynamic set) ----------
  function initTextInputs() {
    document.querySelectorAll("input[data-field], textarea[data-field]").forEach((el) => {
      const field = el.dataset.field;
      const onChange = () => {
        setPath(field, el.value);
        renderSummary();
        renderSectionNav();
        updateSubmitState();
        saveDraft(DRAFT_KEY, state.data);
      };
      el.addEventListener("input", onChange);
      el.addEventListener("change", onChange);
    });
  }

  function syncTextInputsFromDom() {
    document.querySelectorAll("input[data-field], textarea[data-field]").forEach((el) => {
      setPath(el.dataset.field, el.value);
    });
  }

  // ---------- Live summary ----------
  function renderSummary() {
    const serviceLabels = state.data.services.map((s) => SERVICE_LABELS[s] || s).join(", ");
    const rows = [
      summaryRow("Services", serviceLabels, state.data.services.length === 0),
      summaryRow("Contact", [state.data.name, state.data.email].filter(Boolean).join(" · "), !state.data.name && !state.data.email),
    ];
    els.summaryList.innerHTML = rows.join("");
  }

  // ---------- Submit gating ----------
  function updateSubmitState() {
    const incomplete = activeSteps().filter((k) => !isPanelComplete(k));
    els.btnSubmit.disabled = incomplete.length > 0;
    els.submitHint.textContent =
      incomplete.length === 0
        ? "Everything looks good — ready to send."
        : `Finish ${incomplete.map((k) => PANEL_LABELS[k] || k).join(" and ")} to submit.`;
  }

  // ---------- Submission ----------
  function initSubmit() {
    els.btnSubmit.addEventListener("click", () => {
      syncTextInputsFromDom();
      renderSummary();
      updateSubmitState();
      if (!isAllComplete()) {
        const firstIncomplete = activeSteps().find((k) => !isPanelComplete(k));
        if (firstIncomplete) goToPanel(firstIncomplete);
        els.submitHint.classList.remove("hint-flash");
        void els.submitHint.offsetWidth;
        els.submitHint.classList.add("hint-flash");
        return;
      }
      submitServices();
    });
  }

  async function submitServices() {
    els.btnSubmit.disabled = true;
    els.submitHint.textContent = "Sending…";

    const payload = { name: state.data.name, email: state.data.email, services: state.data.services };
    for (const slug of state.data.services) {
      payload[SERVICE_DATA_KEYS[slug]] = state.data[SERVICE_DATA_KEYS[slug]];
    }

    try {
      await saveSubmission("services", payload);
    } catch (err) {
      els.btnSubmit.disabled = false;
      els.submitHint.textContent = err.message;
      return;
    }

    clearDraft(DRAFT_KEY);

    els.layout.style.transition = "opacity 0.3s var(--ease)";
    els.layout.style.opacity = "0";

    window.setTimeout(() => {
      els.layout.hidden = true;
      renderSuccessSummary();
      els.successState.hidden = false;
      window.scrollTo({ top: 0, behavior: "instant" });
      els.successState.querySelector(".success-title").focus();
    }, 300);
  }

  function renderSuccessSummary() {
    els.successSub.textContent = `We'll review your project details and follow up at ${state.data.email} within one business day.`;
    els.successSummary.innerHTML = `
      <div class="success-summary-row"><span>Services</span><strong>${state.data.services.map((s) => escapeHtml(SERVICE_LABELS[s] || s)).join(", ")}</strong></div>
      <div class="success-summary-row"><span>Contact</span><strong>${escapeHtml(state.data.name)}</strong></div>
    `;
  }

  // ---------- Draft restore ----------
  function restoreDraft(data) {
    Object.assign(state.data, data);
    // Re-hydrate selector UI state from the restored data — no shared
    // hydrateFieldSelectors() call here since field paths are dotted/
    // dynamic; this walks every selector group itself instead.
    document.querySelectorAll("[data-field]").forEach((group) => {
      if (!group.classList.contains("toggle-grid") && !group.classList.contains("pill-row")) return;
      const field = group.dataset.field;
      const selector = group.classList.contains("pill-row") ? ".pill" : ".bento-card";
      const value = getPath(field);
      group.querySelectorAll(selector).forEach((item) => {
        const selected = Array.isArray(value) ? value.includes(item.dataset.value) : value === item.dataset.value;
        item.classList.toggle("selected", selected);
        item.setAttribute("aria-pressed", String(selected));
      });
    });
    document.querySelectorAll("input[data-field], textarea[data-field]").forEach((el) => {
      const value = getPath(el.dataset.field);
      if (typeof value === "string") el.value = value;
    });
    renderSectionNav();
    renderSummary();
    updateSubmitState();
  }

  // The three new service marketing pages link here as
  // services.html?service=ai-integration (etc.) so the relevant card is
  // already checked on arrival — one fewer click for someone who came from
  // a page specifically about that service. Silently ignores an unknown/
  // missing value; the picker just starts empty in that case, same as
  // navigating here directly.
  function preselectFromQueryString() {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("service");
    if (!requested || !SERVICE_SLUGS.includes(requested) || state.data.services.includes(requested)) return;
    state.data.services.push(requested);
    const card = document.querySelector(`.toggle-grid[data-field="services"] .bento-card[data-value="${requested}"]`);
    if (card) {
      card.classList.add("selected");
      card.setAttribute("aria-pressed", "true");
    }
  }

  function init() {
    initCommon();
    initSelectors();
    initTextInputs();
    initSectionContinue();
    initSubmit();
    preselectFromQueryString();
    renderSectionNav();
    renderSummary();
    updateSubmitState();
    initDraftBanner(DRAFT_KEY, restoreDraft);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
