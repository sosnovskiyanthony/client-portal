(() => {
  const TOTAL_SECTIONS = 3;
  const SECTION_LABELS = { 1: "Vision & Goals", 2: "Capabilities", 3: "Timeline & Contact" };

  const state = {
    section: 1,
    data: {
      goal: null,
      summary: "",
      brandStatus: null,
      features: [],
      contentReadiness: null,
      timeline: null,
      name: "",
      email: "",
      website: "",
    },
  };

  const LABELS = {
    goal: {
      "lead-gen": "Lead Generation / Sales",
      ecommerce: "E-Commerce Storefront",
      brand: "Brand Authority / Portfolio",
      webapp: "Custom Web App / SaaS",
    },
    brandStatus: {
      established: "Fully established",
      expansion: "Needs expansion",
      scratch: "Starting from scratch",
    },
    features: {
      cms: "CMS Integration",
      animations: "Advanced Animations",
      integrations: "Third-Party Integrations",
      auth: "User Authentication / Portals",
      multilingual: "Multilingual Support",
    },
    contentReadiness: {
      ready: "Ready to go",
      draft: "Rough draft",
      help: "Need complete help",
    },
    timeline: {
      "2-4-weeks": "2–4 Weeks",
      "1-2-months": "1–2 Months",
      "3-plus-months": "3+ Months",
    },
  };

  const els = {
    tabs: Array.from(document.querySelectorAll(".nav-tab[data-section]")),
    layout: document.getElementById("layout"),
    stepContent: document.getElementById("step-content"),
    summaryList: document.getElementById("summary-list"),
    btnSubmit: document.getElementById("btn-submit"),
    submitHint: document.getElementById("submit-hint"),
    successState: document.getElementById("success-state"),
    successSub: document.getElementById("success-sub"),
    successSummary: document.getElementById("success-summary"),
  };

  function panelFor(section) {
    return document.querySelector(`.step-panel[data-step="${section}"]`);
  }

  function initMagneticCards() {
    document.querySelectorAll(".bento-card").forEach(attachMagneticTilt);
  }

  // ---------- Selectors ----------

  function initSelectors() {
    document.querySelectorAll("[data-field]").forEach((group) => {
      const field = group.dataset.field;
      const mode = group.dataset.mode;
      const selector = group.classList.contains("pill-row") ? ".pill" : ".bento-card";

      group.querySelectorAll(selector).forEach((c) => c.setAttribute("aria-pressed", "false"));

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
          state.data[field] = value;
        } else {
          item.classList.toggle("selected");
          item.setAttribute("aria-pressed", String(item.classList.contains("selected")));
          const list = state.data[field];
          const idx = list.indexOf(value);
          if (item.classList.contains("selected") && idx === -1) list.push(value);
          if (!item.classList.contains("selected") && idx !== -1) list.splice(idx, 1);
        }

        renderSummary();
        updateTabs();
        updateSubmitState();
      });
    });
  }

  // ---------- Text inputs ----------

  function initTextInputs() {
    const bindings = [
      ["input-summary", "summary"],
      ["input-name", "name"],
      ["input-email", "email"],
      ["input-website", "website"],
    ];

    bindings.forEach(([id, field]) => {
      const el = document.getElementById(id);
      el.addEventListener("input", () => {
        state.data[field] = el.value;
        renderSummary();
        updateTabs();
        updateSubmitState();
      });
    });
  }

  // ---------- Validation ----------

  function isSectionComplete(section) {
    const d = state.data;
    if (section === 1) return Boolean(d.goal) && d.summary.trim().length > 0 && Boolean(d.brandStatus);
    if (section === 2) return d.features.length > 0 && Boolean(d.contentReadiness);
    if (section === 3) return Boolean(d.timeline) && d.name.trim().length > 0 && /\S+@\S+\.\S+/.test(d.email);
    return true;
  }

  function isSectionStarted(section) {
    const d = state.data;
    if (section === 1) return Boolean(d.goal) || d.summary.trim().length > 0 || Boolean(d.brandStatus);
    if (section === 2) return d.features.length > 0 || Boolean(d.contentReadiness);
    if (section === 3) return Boolean(d.timeline) || d.name.trim().length > 0 || d.email.trim().length > 0 || d.website.trim().length > 0;
    return false;
  }

  function isAllComplete() {
    return isSectionComplete(1) && isSectionComplete(2) && isSectionComplete(3);
  }

  function getIncompleteSections() {
    return [1, 2, 3].filter((n) => !isSectionComplete(n));
  }

  // ---------- Tabs ----------

  function initTabs() {
    els.tabs.forEach((tab) => {
      tab.addEventListener("click", () => goToSection(Number(tab.dataset.section)));
    });

    document.querySelectorAll(".section-continue").forEach((btn) => {
      btn.addEventListener("click", () => goToSection(Number(btn.dataset.goto)));
    });
  }

  function updateTabs() {
    els.tabs.forEach((tab) => {
      const n = Number(tab.dataset.section);
      tab.classList.toggle("active", n === state.section);

      const dot = tab.querySelector(".nav-tab-dot");
      dot.classList.remove("partial", "complete");
      if (isSectionComplete(n)) dot.classList.add("complete");
      else if (isSectionStarted(n)) dot.classList.add("partial");
    });
  }

  // ---------- Submit gating ----------

  function updateSubmitState() {
    const incomplete = getIncompleteSections();
    els.btnSubmit.disabled = incomplete.length > 0;

    if (incomplete.length === 0) {
      els.submitHint.innerHTML = "Everything looks good — ready to send.";
      return;
    }

    const links = incomplete
      .map((n) => `<span class="hint-link" data-goto="${n}">${SECTION_LABELS[n]}</span>`)
      .join(" and ");
    els.submitHint.innerHTML = `Finish ${links} to submit.`;
  }

  function initSubmitHint() {
    els.submitHint.addEventListener("click", (e) => {
      const link = e.target.closest(".hint-link");
      if (!link) return;
      goToSection(Number(link.dataset.goto));
    });
  }

  // ---------- Live summary ----------

  function summaryRow(label, value, empty) {
    return `
      <div class="summary-row">
        <span class="summary-row-label">${label}</span>
        <span class="summary-row-value${empty ? " empty" : ""}">${empty ? "Not selected yet" : escapeHtml(value)}</span>
      </div>
    `;
  }

  function renderSummary() {
    const d = state.data;
    const rows = [];

    rows.push(summaryRow("Goal", LABELS.goal[d.goal], !d.goal));
    rows.push(summaryRow("Business summary", d.summary, !d.summary.trim()));
    rows.push(summaryRow("Brand guidelines", LABELS.brandStatus[d.brandStatus], !d.brandStatus));
    rows.push(
      summaryRow(
        "Features",
        d.features.map((f) => LABELS.features[f]).join(", "),
        d.features.length === 0
      )
    );
    rows.push(summaryRow("Content readiness", LABELS.contentReadiness[d.contentReadiness], !d.contentReadiness));
    rows.push(summaryRow("Timeline", LABELS.timeline[d.timeline], !d.timeline));
    rows.push(summaryRow("Contact", [d.name, d.email, d.website].filter(Boolean).join(" · "), !d.name && !d.email && !d.website));

    els.summaryList.innerHTML = rows.join("");
  }

  // ---------- Section transitions (animated height, free-roam) ----------

  let transitioning = false;

  function goToSection(newSection) {
    if (transitioning || newSection === state.section || newSection < 1 || newSection > TOTAL_SECTIONS) return;
    transitioning = true;

    const container = els.stepContent;
    const oldPanel = panelFor(state.section);
    const newPanel = panelFor(newSection);

    // Lock the current height as the transition's starting point.
    container.style.height = `${container.offsetHeight}px`;
    void container.offsetHeight;

    // Measure the incoming panel's natural height before touching layout.
    newPanel.classList.add("measuring");
    const targetHeight = newPanel.scrollHeight;
    newPanel.classList.remove("measuring");

    // Pull the outgoing panel out of flow immediately so it can't hold the
    // container open while it fades — this is what caused the empty-space
    // glitch when jumping from a tall section to a short one.
    oldPanel.classList.remove("active");
    oldPanel.classList.add("leaving");

    // Bring the incoming panel into flow and animate to its target height
    // in the same tick, so the resize and the crossfade run concurrently.
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

    state.section = newSection;
    updateTabs();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- Submission ----------

  function initSubmit() {
    els.btnSubmit.addEventListener("click", () => {
      if (!isAllComplete()) return;
      submitProject();
    });
  }

  async function submitProject() {
    els.btnSubmit.disabled = true;
    els.submitHint.textContent = "Sending…";

    try {
      await saveSubmission("web-design", state.data);
    } catch (err) {
      els.btnSubmit.disabled = false;
      els.submitHint.textContent = err.message;
      return;
    }

    // #nav-pill is site-wide navigation (Web Design/SEO/Contact), so it
    // stays visible on the success screen — only the questionnaire fades out.
    els.layout.style.transition = "opacity 0.3s var(--ease)";
    els.layout.style.opacity = "0";

    window.setTimeout(() => {
      els.layout.hidden = true;
      renderSuccess();
      els.successState.hidden = false;
    }, 300);
  }

  function renderSuccess() {
    const d = state.data;
    els.successSub.textContent = `We'll review your project details and follow up at ${d.email} within one business day.`;
    els.successSummary.innerHTML = `
      <div class="success-summary-row"><span>Goal</span><strong>${escapeHtml(LABELS.goal[d.goal] || "")}</strong></div>
      <div class="success-summary-row"><span>Timeline</span><strong>${escapeHtml(LABELS.timeline[d.timeline] || "")}</strong></div>
      <div class="success-summary-row"><span>Contact</span><strong>${escapeHtml(d.name)}</strong></div>
      ${d.website ? `<div class="success-summary-row"><span>Website</span><strong>${escapeHtml(d.website)}</strong></div>` : ""}
    `;
  }

  // ---------- Init ----------

  function init() {
    initCommon();
    initMagneticCards();
    initTabs();
    initSelectors();
    initTextInputs();
    initSubmitHint();
    initSubmit();

    renderSummary();
    updateTabs();
    updateSubmitState();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
