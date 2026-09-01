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
      // { path, filename, contentType, sizeBytes } per file — path is a
      // Supabase Storage object key issued by uploadSelectedAssets() below,
      // not anything client-controlled. See intakeController.uploadBrandAssets.
      brandAssets: [],
    },
  };

  // Sourced from the shared FIELD_LABELS in common.js (loaded before this
  // file) rather than defined locally — see that file for the single source
  // of truth these values come from.
  const LABELS = {
    goal: FIELD_LABELS.goal,
    brandStatus: FIELD_LABELS.brandStatus,
    features: FIELD_LABELS.features,
    contentReadiness: FIELD_LABELS.contentReadiness,
    timeline: FIELD_LABELS.timeline,
  };

  const DRAFT_KEY = "web-design";
  const TEXT_BINDINGS = [
    ["input-summary", "summary"],
    ["input-name", "name"],
    ["input-email", "email"],
    ["input-website", "website"],
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
    assetInput: document.getElementById("input-brand-assets"),
    assetList: document.getElementById("asset-list"),
    assetStatus: document.getElementById("asset-upload-status"),
  };

  // panelFor, initMagneticCards, summaryRow, and the animated section
  // transition (goToSection, below) are shared with seo.js — see common.js.

  // ---------- Brand asset uploads ----------
  // Files upload straight to Supabase Storage through the server as soon as
  // they're selected (not deferred to final submit) — the form only ever
  // carries the resulting {path, filename, contentType, sizeBytes} refs in
  // state.data.brandAssets, never raw file bytes. This is also why a saved
  // draft (see common.js's saveDraft) can safely restore an in-progress
  // upload list: it's just small JSON, the files themselves are already
  // safely in storage.

  const MAX_BRAND_ASSETS = 5;
  const MAX_ASSET_BYTES = 15 * 1024 * 1024;
  // SVG deliberately excluded — it's an active format (can embed <script>),
  // and this file gets served back to the admin via direct navigation on
  // "View", not a sandboxed <img>. See controllers/intakeController.js's
  // matching allowlist.
  const ALLOWED_ASSET_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"];

  function renderAssetList() {
    els.assetList.innerHTML = state.data.brandAssets
      .map(
        (a, i) => `
        <li class="asset-item">
          <span class="asset-item-name">${escapeHtml(a.filename)}</span>
          <button class="asset-item-remove" data-remove-index="${i}" type="button" aria-label="Remove ${escapeHtml(a.filename)}">&times;</button>
        </li>
      `
      )
      .join("");
  }

  async function uploadSelectedAssets(fileList) {
    const remaining = MAX_BRAND_ASSETS - state.data.brandAssets.length;
    if (remaining <= 0) {
      els.assetStatus.textContent = `You can attach up to ${MAX_BRAND_ASSETS} files.`;
      return;
    }

    const files = Array.from(fileList).slice(0, remaining);
    const rejected = [];
    const valid = files.filter((f) => {
      if (!ALLOWED_ASSET_TYPES.includes(f.type)) {
        rejected.push(`${f.name} (unsupported type)`);
        return false;
      }
      if (f.size > MAX_ASSET_BYTES) {
        rejected.push(`${f.name} (over 15MB)`);
        return false;
      }
      return true;
    });

    if (valid.length === 0) {
      els.assetStatus.textContent = rejected.length ? `Couldn't attach: ${rejected.join(", ")}` : "";
      return;
    }

    els.assetStatus.textContent = "Uploading…";
    const formData = new FormData();
    valid.forEach((f) => formData.append("files", f));

    let res;
    try {
      res = await fetch("/api/intake/web-design/assets", { method: "POST", body: formData });
    } catch (err) {
      els.assetStatus.textContent = "Can't reach the server. Is the backend running?";
      return;
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      els.assetStatus.textContent = body.error || "Upload failed.";
      return;
    }

    state.data.brandAssets.push(...body.files);
    renderAssetList();
    saveDraft(DRAFT_KEY, state.data);
    els.assetStatus.textContent = rejected.length
      ? `Attached ${body.files.length} file(s). Couldn't attach: ${rejected.join(", ")}`
      : `Attached ${body.files.length} file(s).`;
  }

  function initAssetUpload() {
    els.assetInput.addEventListener("change", () => {
      const files = els.assetInput.files;
      if (files && files.length > 0) uploadSelectedAssets(files);
      els.assetInput.value = ""; // clear so the same file(s) can be re-selected later if removed
    });

    els.assetList.addEventListener("click", (e) => {
      const btn = e.target.closest(".asset-item-remove[data-remove-index]");
      if (!btn) return;
      state.data.brandAssets.splice(Number(btn.dataset.removeIndex), 1);
      renderAssetList();
      saveDraft(DRAFT_KEY, state.data);
    });
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
      // "change" fires on blur regardless, so this closes that gap for the
      // live UI (tab dots, hint text) — see submitProject()'s own
      // syncTextInputsFromDom() call for the actual safety net at submit
      // time, which is what fixes this even if both events somehow miss.
      el.addEventListener("input", onChange);
      el.addEventListener("change", onChange);
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
    // Optional field — only shown once something's actually attached, unlike
    // the required fields above which show "Not selected yet" when empty.
    if (d.brandAssets.length > 0) {
      rows.push(summaryRow("Brand assets", d.brandAssets.map((a) => a.filename).join(", "), false));
    }

    els.summaryList.innerHTML = rows.join("");
  }

  // ---------- Section transitions (animated height, free-roam) ----------
  // The actual animation lives in common.js's createSectionNavigator,
  // shared with seo.js — only what's specific to this page (current
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
      // syncTextInputsFromDom's own comment in common.js. Without this, a
      // client whose browser filled a field via autofill without firing
      // "input"/"change" (a real iOS Safari QuickType quirk) would look at
      // a fully-filled-in form and have nothing happen when they click
      // Submit, with no indication why. This makes what's on screen the
      // actual source of truth at the one moment it matters most.
      syncTextInputsFromDom(TEXT_BINDINGS, state.data);
      renderSummary();
      updateTabs();
      updateSubmitState();

      if (!isAllComplete()) {
        // Never silently no-op on a click — if it's still incomplete after
        // re-syncing, make that visible and take them to it, rather than
        // leaving a visitor staring at a button that just doesn't respond.
        const firstIncomplete = getIncompleteSections()[0];
        goToSection(firstIncomplete);
        els.submitHint.classList.remove("hint-flash");
        void els.submitHint.offsetWidth; // restart the CSS animation on repeat clicks
        els.submitHint.classList.add("hint-flash");
        return;
      }
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

    clearDraft(DRAFT_KEY);

    // #nav-pill is site-wide navigation (Web Design/SEO/Contact), so it
    // stays visible on the success screen — only the questionnaire fades out.
    els.layout.style.transition = "opacity 0.3s var(--ease)";
    els.layout.style.opacity = "0";

    window.setTimeout(() => {
      els.layout.hidden = true;
      renderSuccess();
      els.successState.hidden = false;
      // A visitor who scrolled down to reach the contact fields (the common
      // case on mobile, where the form runs well past one screen) keeps that
      // scroll position when the much-shorter success screen swaps in — with
      // nothing to reset it, they're left looking at blank space past the
      // end of the new page, which reads as "nothing happened." iOS Safari
      // also doesn't reliably auto-scroll a tabindex="-1" element into view
      // on focus() the way desktop browsers do, so this can't be left to
      // that call alone.
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
    els.successSub.textContent = `We'll review your project details and follow up at ${d.email} within one business day.`;
    els.successSummary.innerHTML = `
      <div class="success-summary-row"><span>Goal</span><strong>${escapeHtml(LABELS.goal[d.goal] || "")}</strong></div>
      <div class="success-summary-row"><span>Timeline</span><strong>${escapeHtml(LABELS.timeline[d.timeline] || "")}</strong></div>
      <div class="success-summary-row"><span>Contact</span><strong>${escapeHtml(d.name)}</strong></div>
      ${d.website ? `<div class="success-summary-row"><span>Website</span><strong>${escapeHtml(d.website)}</strong></div>` : ""}
    `;
  }

  // ---------- Init ----------

  function restoreDraft(data) {
    Object.assign(state.data, data);
    if (!Array.isArray(state.data.brandAssets)) state.data.brandAssets = [];
    hydrateFieldSelectors(state.data);
    hydrateTextInputs(TEXT_BINDINGS, state.data);
    renderAssetList();
    renderSummary();
    updateTabs();
    updateSubmitState();
  }

  function init() {
    initCommon();
    initMagneticCards();
    initTabs();
    initSelectors();
    initTextInputs();
    initAssetUpload();
    initSubmitHint();
    initSubmit();
    initDraftBanner(DRAFT_KEY, restoreDraft);

    renderSummary();
    updateTabs();
    updateSubmitState();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
