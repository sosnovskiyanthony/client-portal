(() => {
  const state = {
    data: {
      name: "",
      email: "",
      reason: null,
      message: "",
    },
  };

  // Sourced from the shared FIELD_LABELS in common.js (loaded before this
  // file) rather than defined locally — see that file for the single source
  // of truth these values come from.
  const LABELS = {
    reason: FIELD_LABELS.reason,
  };

  const DRAFT_KEY = "contact";
  const TEXT_BINDINGS = [
    ["input-name", "name"],
    ["input-email", "email"],
    ["input-message", "message"],
  ];

  const els = {
    layout: document.getElementById("layout"),
    btnSubmit: document.getElementById("btn-submit"),
    submitHint: document.getElementById("submit-hint"),
    successState: document.getElementById("success-state"),
    successSub: document.getElementById("success-sub"),
    successSummary: document.getElementById("success-summary"),
  };

  // ---------- Selectors ----------

  function initSelectors() {
    document.querySelectorAll("[data-field]").forEach((group) => {
      const field = group.dataset.field;
      const selector = ".pill";

      group.querySelectorAll(selector).forEach((c) => c.setAttribute("aria-pressed", "false"));

      group.addEventListener("click", (e) => {
        const item = e.target.closest(selector);
        if (!item) return;
        const value = item.dataset.value;

        group.querySelectorAll(selector).forEach((c) => {
          c.classList.remove("selected");
          c.setAttribute("aria-pressed", "false");
        });
        item.classList.add("selected");
        item.setAttribute("aria-pressed", "true");
        state.data[field] = value;

        updateSubmitState();
        saveDraft(DRAFT_KEY, state.data);
      });
    });
  }

  // ---------- Text inputs ----------

  function initTextInputs() {
    TEXT_BINDINGS.forEach(([id, field]) => {
      const el = document.getElementById(id);
      el.addEventListener("input", () => {
        state.data[field] = el.value;
        updateSubmitState();
        saveDraft(DRAFT_KEY, state.data);
      });
    });
  }

  // ---------- Validation ----------

  function isComplete() {
    const d = state.data;
    return d.name.trim().length > 0 && /\S+@\S+\.\S+/.test(d.email) && d.message.trim().length > 0;
  }

  function updateSubmitState() {
    els.btnSubmit.disabled = !isComplete();
    els.submitHint.textContent = isComplete()
      ? "Everything looks good — ready to send."
      : "Fill in your name, email, and a message to send.";
  }

  // ---------- Submission ----------

  function initSubmit() {
    els.btnSubmit.addEventListener("click", () => {
      if (!isComplete()) return;
      submitMessage();
    });
  }

  async function submitMessage() {
    els.btnSubmit.disabled = true;
    els.submitHint.textContent = "Sending…";

    try {
      await saveSubmission("contact", state.data);
    } catch (err) {
      els.btnSubmit.disabled = false;
      els.submitHint.textContent = err.message;
      return;
    }

    clearDraft(DRAFT_KEY);

    // #nav-pill is site-wide navigation (Web Design/SEO/Contact), so it
    // stays visible on the success screen — only the form fades out.
    els.layout.style.transition = "opacity 0.3s var(--ease)";
    els.layout.style.opacity = "0";

    window.setTimeout(() => {
      els.layout.hidden = true;
      renderSuccess();
      els.successState.hidden = false;
      // Move focus into the newly-revealed content so keyboard/screen-reader
      // users land on it instead of losing their place when the form
      // disappears — the heading has tabindex="-1" so it's focusable
      // programmatically without being in the normal Tab order.
      els.successState.querySelector(".success-title").focus();
    }, 300);
  }

  function renderSuccess() {
    const d = state.data;
    els.successSub.textContent = `Thanks — we'll get back to you at ${d.email} within one business day.`;
    els.successSummary.innerHTML = `
      <div class="success-summary-row"><span>From</span><strong>${escapeHtml(d.name)}</strong></div>
      ${d.reason ? `<div class="success-summary-row"><span>Regarding</span><strong>${escapeHtml(LABELS.reason[d.reason])}</strong></div>` : ""}
    `;
  }

  // ---------- Init ----------

  function restoreDraft(data) {
    Object.assign(state.data, data);
    hydrateFieldSelectors(state.data);
    hydrateTextInputs(TEXT_BINDINGS, state.data);
    updateSubmitState();
  }

  function init() {
    initCommon();
    initSelectors();
    initTextInputs();
    initSubmit();
    initDraftBanner(DRAFT_KEY, restoreDraft);

    updateSubmitState();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
