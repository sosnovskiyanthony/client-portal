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

  // Sourced from the shared FIELD_LABELS in common.js (loaded before this
  // file) rather than defined locally — see that file for the single source
  // of truth these values come from.
  const LABELS = {
    challenge: FIELD_LABELS.challenge,
    visibility: FIELD_LABELS.visibility,
  };

  const DRAFT_KEY = "seo";
  const TEXT_BINDINGS = [
    ["input-url", "url"],
    ["input-keywords", "keywords"],
    ["input-name", "name"],
    ["input-email", "email"],
    ["input-notes", "notes"],
  ];

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

  // panelFor, initMagneticCards, summaryRow, and the animated section
  // transition (goToSection, below) are shared with web-design.js — see
  // common.js.

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
        saveDraft(DRAFT_KEY, state.data);
      });
    });
  }

  // ---------- Text inputs ----------

  function initTextInputs() {
    TEXT_BINDINGS.forEach(([id, field]) => {
      const el = document.getElementById(id);
      const onChange = () => {
        state.data[field] = el.value;
        renderSummary();
        updateTabs();
        updateSubmitState();
        saveDraft(DRAFT_KEY, state.data);
      };
      // Both "input" and "change" — iOS Safari's QuickType autofill bar
      // (name/email fields both use autocomplete=) has a real, documented
      // history of not reliably firing "input" alone in every iOS version.
      // See initSubmit()'s own syncTextInputsFromDom() call for the actual
      // safety net at submit time.
      el.addEventListener("input", onChange);
      el.addEventListener("change", onChange);
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
  // The actual animation lives in common.js's createSectionNavigator,
  // shared with web-design.js — only what's specific to this page (current
  // section, how to update it) is supplied here.

  const goToSection = createSectionNavigator({
    totalSections: TOTAL_SECTIONS,
    stepContentEl: els.stepContent,
    getCurrentSection: () => state.section,
    onSectionChange: (newSection) => {
      state.section = newSection;
      updateTabs();
    },
  });

  // ---------- Submission ----------

  function initSubmit() {
    els.btnSubmit.addEventListener("click", () => {
      // Re-sync from the actual DOM values first — see
      // syncTextInputsFromDom's own comment in common.js.
      syncTextInputsFromDom(TEXT_BINDINGS, state.data);
      renderSummary();
      updateTabs();
      updateSubmitState();

      if (!isAllComplete()) {
        const firstIncomplete = getIncompleteSections()[0];
        goToSection(firstIncomplete);
        els.submitHint.classList.remove("hint-flash");
        void els.submitHint.offsetWidth;
        els.submitHint.classList.add("hint-flash");
        return;
      }
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

    clearDraft(DRAFT_KEY);

    // #nav-pill is site-wide navigation (Web Design/SEO/Contact), so it
    // stays visible on the success screen — only the questionnaire fades out.
    els.layout.style.transition = "opacity 0.3s var(--ease)";
    els.layout.style.opacity = "0";

    window.setTimeout(() => {
      els.layout.hidden = true;
      renderSuccess();
      els.successState.hidden = false;
      // A visitor who scrolled down to reach the contact fields keeps that
      // scroll position when the much-shorter success screen swaps in — see
      // web-design.js's submitProject() for the full explanation.
      window.scrollTo({ top: 0, behavior: "instant" });
      // Move focus into the newly-revealed content so keyboard/screen-reader
      // users land on it instead of losing their place when the form
      // disappears — the heading has tabindex="-1" so it's focusable
      // programmatically without being in the normal Tab order.
      els.successState.querySelector(".success-title").focus();
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

  function restoreDraft(data) {
    Object.assign(state.data, data);
    hydrateFieldSelectors(state.data);
    hydrateTextInputs(TEXT_BINDINGS, state.data);
    renderSummary();
    updateTabs();
    updateSubmitState();
  }

  function init() {
    initCommon();
    initMagneticCards();
    initAccordion();
    initTabs();
    initSelectors();
    initTextInputs();
    initSubmitHint();
    initSubmit();
    initDraftBanner(DRAFT_KEY, restoreDraft);

    renderSummary();
    updateTabs();
    updateSubmitState();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
