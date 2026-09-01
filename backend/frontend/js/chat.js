// AI chat feature — an interface to the exact same analysis pipeline
// admin.js's "Analyze with AI" button uses (see backend/ai/aiService.js).
// Deliberately a separate script/module from admin.js: it only needs
// common.js's contractFetch/escapeHtml/getAdminToken and a few DOM ids
// (see admin.html's #chat-drawer-* markup), and talking to admin.js only
// through a couple of data attributes on the buttons it renders
// (data-chat-id/data-chat-name) and one custom event
// (studio:submissions-changed) — no shared module state, so this file can
// be read and changed on its own.
(() => {
  const els = {
    overlay: document.getElementById("chat-drawer-overlay"),
    title: document.getElementById("chat-drawer-title"),
    sub: document.getElementById("chat-drawer-sub"),
    closeBtn: document.getElementById("chat-drawer-close"),
    thread: document.getElementById("chat-thread"),
    pastePanel: document.getElementById("chat-paste-panel"),
    pasteInput: document.getElementById("chat-paste-input"),
    pasteStandaloneFields: document.getElementById("chat-paste-standalone-fields"),
    pasteClientName: document.getElementById("chat-paste-client-name"),
    pasteClientEmail: document.getElementById("chat-paste-client-email"),
    pasteCancel: document.getElementById("chat-paste-cancel"),
    pasteSubmit: document.getElementById("chat-paste-submit"),
    pasteError: document.getElementById("chat-paste-error"),
    footer: document.getElementById("chat-drawer-footer"),
    pasteToggle: document.getElementById("chat-paste-toggle"),
    input: document.getElementById("chat-input"),
    sendBtn: document.getElementById("chat-send-btn"),
    inputError: document.getElementById("chat-input-error"),
    newAnalysisBtn: document.getElementById("new-analysis-btn"),
  };

  // Not every page loads chat.js's markup (only admin.html does) — bail
  // out quietly rather than throwing on a null element if this ever ends
  // up included somewhere it shouldn't be.
  if (!els.overlay) return;

  let submissionId = null; // null = standalone mode
  let standaloneRequestId = null;
  let messages = []; // scoped mode only — standalone never persists a thread
  let standaloneResult = null; // last analyze outcome in standalone mode, held until saved
  let sending = false;
  let analyzing = false;
  let progressPollHandle = null;
  let thinkingEl = null;

  const STAGE_LABELS = {
    preparing: "Preparing",
    sending: "Sending to Ollama",
    generating: "Generating",
    validating: "Validating response",
    saving: "Saving",
  };

  function stopPolling() {
    if (progressPollHandle) {
      clearInterval(progressPollHandle);
      progressPollHandle = null;
    }
  }

  function startPolling(fetchProgress) {
    stopPolling();
    progressPollHandle = setInterval(async () => {
      try {
        const progress = await fetchProgress();
        if (progress && progress.active && thinkingEl) {
          thinkingEl.textContent = `${STAGE_LABELS[progress.stage] || "Working"}…`;
        }
      } catch (err) {
        // best-effort — a failed poll just leaves the last-known label showing
      }
    }, 1000);
  }

  function showThinking(label) {
    removeThinking();
    thinkingEl = document.createElement("div");
    thinkingEl.className = "chat-bubble chat-bubble-assistant chat-bubble-thinking";
    thinkingEl.textContent = label;
    els.thread.appendChild(thinkingEl);
    els.thread.scrollTop = els.thread.scrollHeight;
  }

  function removeThinking() {
    if (thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  function scrollToBottom() {
    els.thread.scrollTop = els.thread.scrollHeight;
  }

  // Compact rendering of an AnalysisSchema-shaped result — not every field
  // (that's what admin.js's full submission-card view is for), just enough
  // for the admin to judge the result in context without leaving the chat.
  // Reuses the same CSS classes as admin.js's renderAnalysisSection for
  // visual consistency, but is written standalone here rather than shared
  // code, since admin.js's version lives inside its own closure and isn't
  // exposed for another script to call.
  function renderAnalysisCard(result, saveButtonHtml) {
    const r = result || {};
    const pills = [
      r.complexity ? `<span class="analysis-pill analysis-pill-${escapeHtml(r.complexity)}">Complexity: ${escapeHtml(r.complexity)}</span>` : "",
      r.priority ? `<span class="analysis-pill analysis-pill-${escapeHtml(r.priority)}">Priority: ${escapeHtml(r.priority)}</span>` : "",
      r.scope_recommendation ? `<span class="analysis-pill">Scope: ${escapeHtml(r.scope_recommendation.scope || "")}</span>` : "",
      typeof r.confidence === "number" ? `<span class="analysis-pill">Confidence: ${Math.round(r.confidence * 100)}%</span>` : "",
    ]
      .filter(Boolean)
      .join("");

    const list = (items, emptyText) =>
      Array.isArray(items) && items.length
        ? `<ul class="analysis-list">${items.map((i) => `<li>${escapeHtml(String(i))}</li>`).join("")}</ul>`
        : `<p class="analysis-empty">${escapeHtml(emptyText)}</p>`;

    return `
      <div class="chat-analysis-card">
        <p class="analysis-summary">${escapeHtml(r.project_summary || "")}</p>
        <div class="analysis-pills">${pills}</div>
        <div class="analysis-grid">
          <div class="analysis-block">
            <span class="analysis-block-label">Required features</span>
            ${list(r.required_features, "None explicitly required.")}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Recommended features</span>
            ${list(r.recommended_features, "None suggested.")}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Missing information</span>
            ${list(r.missing_information, "None noted.")}
          </div>
          <div class="analysis-block">
            <span class="analysis-block-label">Critical questions</span>
            ${list(r.critical_questions, "None noted.")}
          </div>
        </div>
        <details class="analysis-raw">
          <summary>Raw JSON (debug)</summary>
          <pre>${escapeHtml(JSON.stringify(r, null, 2))}</pre>
        </details>
        ${saveButtonHtml || ""}
      </div>
    `;
  }

  function renderThread() {
    els.thread.innerHTML = messages
      .map((m, i) => {
        if (m.role === "admin") {
          return `<div class="chat-bubble chat-bubble-admin">${escapeHtml(m.content)}</div>`;
        }
        if (m.role === "assistant") {
          return `<div class="chat-bubble chat-bubble-assistant">${escapeHtml(m.content)}</div>`;
        }
        if (m.role === "analysis") {
          const saveBtn = `<button class="btn btn-primary chat-save-analysis-btn" data-save-msg-index="${i}" type="button">Save as this submission's analysis</button>`;
          return `
            <div class="chat-bubble chat-bubble-analysis">
              <div class="chat-analysis-label">Analysis from pasted client text</div>
              ${m.pastedText ? `<details class="chat-pasted-text"><summary>Pasted text</summary><pre>${escapeHtml(m.pastedText)}</pre></details>` : ""}
              ${renderAnalysisCard(m.content && m.content.result, saveBtn)}
            </div>
          `;
        }
        return "";
      })
      .join("");
    scrollToBottom();
  }

  function resetPasteForm() {
    els.pasteInput.value = "";
    els.pasteClientName.value = "";
    els.pasteClientEmail.value = "";
    els.pasteError.textContent = "";
    els.pastePanel.hidden = true;
  }

  function resetDrawerState() {
    submissionId = null;
    standaloneRequestId = null;
    messages = [];
    standaloneResult = null;
    sending = false;
    analyzing = false;
    stopPolling();
    removeThinking();
    els.thread.innerHTML = "";
    els.input.value = "";
    els.inputError.textContent = "";
    resetPasteForm();
  }

  async function openScoped(id, name) {
    resetDrawerState();
    submissionId = id;
    els.title.textContent = "AI Chat";
    els.sub.textContent = name ? `About: ${name}` : "";
    els.footer.hidden = false;
    els.pasteToggle.hidden = false;
    els.pasteStandaloneFields.hidden = true;
    els.overlay.hidden = false;
    els.input.focus();

    try {
      const data = await contractFetch(`/api/admin/submissions/${id}/chat`);
      messages = (data && data.messages) || [];
      renderThread();
    } catch (err) {
      els.thread.innerHTML = `<p class="chat-error">${escapeHtml(err.message)}</p>`;
    }
  }

  function openStandalone() {
    resetDrawerState();
    standaloneRequestId = crypto.randomUUID();
    els.title.textContent = "New Analysis from Pasted Info";
    els.sub.textContent = "No submission required — paste client info below and analyze it directly.";
    els.footer.hidden = true;
    els.pasteStandaloneFields.hidden = false;
    els.pastePanel.hidden = false;
    els.overlay.hidden = false;
    els.pasteInput.focus();
  }

  function closeDrawer() {
    els.overlay.hidden = true;
    resetDrawerState();
  }

  async function sendMessage() {
    if (sending || !submissionId) return;
    const text = els.input.value.trim();
    if (!text) return;

    sending = true;
    els.sendBtn.disabled = true;
    els.inputError.textContent = "";
    messages.push({ role: "admin", content: text });
    renderThread();
    els.input.value = "";
    showThinking("Thinking…");
    startPolling(() => contractFetch(`/api/admin/submissions/${submissionId}/chat/progress`));

    try {
      const data = await contractFetch(`/api/admin/submissions/${submissionId}/chat`, {
        method: "POST",
        body: { message: text },
      });
      messages = (data.chat && data.chat.messages) || messages;
    } catch (err) {
      els.inputError.textContent = err.message;
      // The admin's message is persisted server-side before the AI call
      // even runs (see services/runChat.js) — reload so it's reflected
      // here even though the reply itself failed.
      try {
        const data = await contractFetch(`/api/admin/submissions/${submissionId}/chat`);
        messages = (data && data.messages) || messages;
      } catch (_) {
        // leave the optimistic local state as-is if even this fails
      }
    } finally {
      stopPolling();
      removeThinking();
      sending = false;
      els.sendBtn.disabled = false;
      renderThread();
    }
  }

  async function submitPaste() {
    if (analyzing) return;
    const text = els.pasteInput.value.trim();
    if (!text) {
      els.pasteError.textContent = "Paste some client text first.";
      return;
    }

    analyzing = true;
    els.pasteSubmit.disabled = true;
    els.pasteError.textContent = "";
    showThinking("Analyzing pasted text…");

    try {
      if (submissionId) {
        startPolling(() => contractFetch(`/api/admin/submissions/${submissionId}/chat/analyze/progress`));
        const outcome = await contractFetch(`/api/admin/submissions/${submissionId}/chat/analyze`, {
          method: "POST",
          body: { text },
        });
        messages.push({ role: "analysis", content: outcome, pastedText: text, createdAt: new Date().toISOString() });
        resetPasteForm();
        renderThread();
      } else {
        startPolling(() => contractFetch(`/api/admin/chat/analyze/progress/${standaloneRequestId}`));
        const outcome = await contractFetch("/api/admin/chat/analyze", {
          method: "POST",
          body: { text, requestId: standaloneRequestId },
        });
        standaloneResult = { outcome, rawText: text };
        renderStandaloneResult();
      }
    } catch (err) {
      els.pasteError.textContent = err.message;
    } finally {
      stopPolling();
      removeThinking();
      analyzing = false;
      els.pasteSubmit.disabled = false;
    }
  }

  function renderStandaloneResult() {
    if (!standaloneResult) return;
    els.pastePanel.hidden = true;
    const saveBtn = `<button class="btn btn-primary chat-save-standalone-btn" type="button">Save as new submission</button>`;
    els.thread.innerHTML = `
      <div class="chat-bubble chat-bubble-analysis">
        <div class="chat-analysis-label">Analysis from pasted client text</div>
        <details class="chat-pasted-text"><summary>Pasted text</summary><pre>${escapeHtml(standaloneResult.rawText)}</pre></details>
        ${renderAnalysisCard(standaloneResult.outcome.result, saveBtn)}
      </div>
    `;
  }

  async function saveScopedAnalysis(index) {
    const msg = messages[index];
    if (!msg || msg.role !== "analysis") return;
    const btn = els.thread.querySelector(`[data-save-msg-index="${index}"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    try {
      await contractFetch(`/api/admin/submissions/${submissionId}/chat/analyze/save`, {
        method: "POST",
        body: { result: msg.content.result, provider: msg.content.provider, model: msg.content.model, promptVersion: msg.content.promptVersion },
      });
      if (btn) {
        btn.textContent = "Saved as this submission's analysis";
      }
      window.dispatchEvent(new CustomEvent("studio:submissions-changed"));
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Save as this submission's analysis";
      }
      els.inputError.textContent = err.message;
    }
  }

  async function saveStandaloneAnalysis() {
    if (!standaloneResult) return;
    const btn = els.thread.querySelector(".chat-save-standalone-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    try {
      const { outcome, rawText } = standaloneResult;
      const data = await contractFetch("/api/admin/chat/analyze/save-as-submission", {
        method: "POST",
        body: {
          result: outcome.result,
          rawText,
          provider: outcome.provider,
          model: outcome.model,
          promptVersion: outcome.promptVersion,
          clientName: els.pasteClientName.value.trim(),
          email: els.pasteClientEmail.value.trim(),
        },
      });
      window.dispatchEvent(new CustomEvent("studio:submissions-changed"));
      if (btn) {
        btn.disabled = true;
        btn.textContent = `Saved — ${data.submission.clientName || "new submission"} added`;
      }
    } catch (err) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Save as new submission";
      }
    }
  }

  function init() {
    document.body.addEventListener("click", (e) => {
      const chatBtn = e.target.closest("[data-chat-id]");
      if (chatBtn) {
        openScoped(Number(chatBtn.dataset.chatId), chatBtn.dataset.chatName);
        return;
      }
    });

    if (els.newAnalysisBtn) {
      els.newAnalysisBtn.addEventListener("click", openStandalone);
    }

    els.closeBtn.addEventListener("click", closeDrawer);
    els.overlay.addEventListener("click", (e) => {
      if (e.target === els.overlay) closeDrawer();
    });
    document.addEventListener("keydown", (e) => {
      if (!els.overlay.hidden && e.key === "Escape") closeDrawer();
    });

    els.sendBtn.addEventListener("click", sendMessage);
    els.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    els.pasteToggle.addEventListener("click", () => {
      els.pastePanel.hidden = !els.pastePanel.hidden;
      if (!els.pastePanel.hidden) els.pasteInput.focus();
    });
    els.pasteCancel.addEventListener("click", resetPasteForm);
    els.pasteSubmit.addEventListener("click", submitPaste);

    els.thread.addEventListener("click", (e) => {
      const saveBtn = e.target.closest("[data-save-msg-index]");
      if (saveBtn) {
        saveScopedAnalysis(Number(saveBtn.dataset.saveMsgIndex));
        return;
      }
      if (e.target.closest(".chat-save-standalone-btn")) {
        saveStandaloneAnalysis();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
