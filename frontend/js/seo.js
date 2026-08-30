(() => {
  const TOTAL_SECTIONS = 3;
  const SECTION_LABELS = { 1: "Site & Keywords", 2: "Visibility & Challenges", 3: "Contact & Review" };

  const state = {
    section: 1,
    data: {
      url: "",
      keywords: "",
      challenge: null,
      visibility: null,
      name: "",
      email: "",
      notes: "",
    },
  };

  const LABELS = {
    challenge: {
      "not-ranking": "Not ranking",
      "traffic-declining": "Traffic declining",
      "low-ctr": "Low click-through",
      "poor-conversion": "Poor conversion",
    },
    visibility: {
      "some-terms": "Ranking well for some terms",
      "barely-visible": "Barely visible",
      "not-sure": "Not sure",
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

      group.addEventListener("click", (e) => {
        const item = e.target.closest(selector);
        if (!item) return;
        const value = item.dataset.value;

        if (mode === "single") {
          group.querySelectorAll(selector).forEach((c) => c.classList.remove("selected"));
          item.classList.add("selected");
          state.data[field] = value;
        } else {
          item.classList.toggle("selected");
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
      ["input-url", "url"],
      ["input-keywords", "keywords"],
      ["input-name", "name"],
      ["input-email", "email"],
      ["input-notes", "notes"],
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
    if (section === 1) return d.url.trim().length > 0 && d.keywords.trim().length > 0;
    if (section === 2) return Boolean(d.challenge) && Boolean(d.visibility);
    if (section === 3) return d.name.trim().length > 0 && /\S+@\S+\.\S+/.test(d.email);
    return true;
  }

  function isSectionStarted(section) {
    const d = state.data;
    if (section === 1) return d.url.trim().length > 0 || d.keywords.trim().length > 0;
    if (section === 2) return Boolean(d.challenge) || Boolean(d.visibility);
    if (section === 3) return d.name.trim().length > 0 || d.email.trim().length > 0 || d.notes.trim().length > 0;
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

    rows.push(summaryRow("Website URL", d.url, !d.url.trim()));
    rows.push(summaryRow("Target keywords", d.keywords, !d.keywords.trim()));
    rows.push(summaryRow("Traffic challenge", LABELS.challenge[d.challenge], !d.challenge));
    rows.push(summaryRow("Search visibility", LABELS.visibility[d.visibility], !d.visibility));
    rows.push(summaryRow("Contact", [d.name, d.email].filter(Boolean).join(" · "), !d.name && !d.email));

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
    // container open while it fades.
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
      submitReview();
    });
  }

  async function submitReview() {
    els.btnSubmit.disabled = true;
    els.submitHint.textContent = "Sending…";

    try {
      await saveSubmission("seo", state.data);
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
    els.successSub.textContent = `We'll audit ${d.url} and follow up at ${d.email} within one business day.`;
    els.successSummary.innerHTML = `
      <div class="success-summary-row"><span>Website</span><strong>${escapeHtml(d.url)}</strong></div>
      <div class="success-summary-row"><span>Challenge</span><strong>${escapeHtml(LABELS.challenge[d.challenge] || "")}</strong></div>
      <div class="success-summary-row"><span>Contact</span><strong>${escapeHtml(d.name)}</strong></div>
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
