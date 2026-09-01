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
    updateAnalysisBtn: document.getElementById("chat-update-analysis-btn"),
    input: document.getElementById("chat-input"),
    sendBtn: document.getElementById("chat-send-btn"),
    researchSendBtn: document.getElementById("chat-research-send-btn"),
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
  let regenerating = false;
  let updatingAnalysis = false;
  let progressPollHandle = null;
  let thinkingEl = null;
  // Fetched once at init — whether the "Research & Send" button should
  // ever be shown at all (server-side: TAVILY_API_KEY configured and
  // AI_PROVIDER=ollama). Not per-submission, so one check covers every
  // time the drawer opens.
  let researchAvailable = false;

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
          return `
            <div class="chat-bubble-group chat-bubble-group-admin">
              <div class="chat-bubble chat-bubble-admin">${escapeHtml(m.content)}</div>
              <div class="chat-bubble-actions">
                <button class="chat-action-btn" data-copy-index="${i}" type="button" title="Copy prompt">Copy</button>
              </div>
            </div>
          `;
        }
        if (m.role === "assistant") {
          const isLast = i === messages.length - 1;
          const hasSources = Array.isArray(m.sources) && m.sources.length > 0;
          return `
            <div class="chat-bubble-group chat-bubble-group-assistant">
              <div class="chat-bubble chat-bubble-assistant">${escapeHtml(m.content)}</div>
              ${
                hasSources
                  ? `<details class="chat-sources">
                      <summary>🔎 Researched ${m.sources.length} source${m.sources.length === 1 ? "" : "s"}</summary>
                      <ul class="chat-sources-list">
                        ${m.sources.map((s) => `<li><a href="${escapeHtml(s.url || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.url || "source")}</a></li>`).join("")}
                      </ul>
                    </details>`
                  : ""
              }
              <div class="chat-bubble-actions">
                <button class="chat-action-btn" data-copy-index="${i}" type="button" title="Copy response">Copy</button>
                ${isLast ? `<button class="chat-action-btn" data-retry-index="${i}" type="button" title="Regenerate response">↻ Retry</button>` : ""}
              </div>
            </div>
          `;
        }
        if (m.role === "analysis") {
          const isUpdate = m.source === "conversation_update";
          const saveLabel = isUpdate ? "Save as this submission's updated analysis" : "Save as this submission's analysis";
          const saveBtn = `<button class="btn btn-primary chat-save-analysis-btn" data-save-msg-index="${i}" type="button">${saveLabel}</button>`;
          return `
            <div class="chat-bubble chat-bubble-analysis">
              <div class="chat-analysis-label">${isUpdate ? "Updated analysis from this conversation" : "Analysis from pasted client text"}</div>
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
    regenerating = false;
    updatingAnalysis = false;
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

  async function sendMessage(research = false) {
    if (sending || !submissionId) return;
    const text = els.input.value.trim();
    if (!text) return;

    sending = true;
    els.sendBtn.disabled = true;
    els.researchSendBtn.disabled = true;
    els.inputError.textContent = "";
    messages.push({ role: "admin", content: text });
    renderThread();
    els.input.value = "";
    showThinking(research ? "Thinking — may search the web if that would help…" : "Thinking…");
    startPolling(() => contractFetch(`/api/admin/submissions/${submissionId}/chat/progress`));

    try {
      const data = await contractFetch(`/api/admin/submissions/${submissionId}/chat`, {
        method: "POST",
        body: { message: text, research },
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
      els.researchSendBtn.disabled = false;
      renderThread();
    }
  }

  async function copyMessage(index, btn) {
    const msg = messages[index];
    if (!msg || typeof msg.content !== "string") return;
    try {
      await navigator.clipboard.writeText(msg.content);
      const original = btn.textContent;
      btn.textContent = "Copied";
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1500);
    } catch (err) {
      // Clipboard access can be denied by the browser — not worth a visible
      // error for a convenience action; the button simply doesn't flip to
      // "Copied", which is signal enough.
    }
  }

  async function retryLastReply(btn) {
    if (regenerating || !submissionId) return;
    regenerating = true;
    btn.disabled = true;

    // Replace the last assistant bubble's own content in place, rather than
    // a full re-render, so the rest of the thread (and scroll position)
    // doesn't jump while this is in flight.
    const group = btn.closest(".chat-bubble-group-assistant");
    const bubble = group?.querySelector(".chat-bubble-assistant");
    const originalText = bubble?.textContent;
    if (bubble) bubble.textContent = "Generating a new response…";
    startPolling(() => contractFetch(`/api/admin/submissions/${submissionId}/chat/progress`));

    try {
      const data = await contractFetch(`/api/admin/submissions/${submissionId}/chat/regenerate`, { method: "POST" });
      messages = (data.chat && data.chat.messages) || messages;
    } catch (err) {
      if (bubble) bubble.textContent = originalText || "";
      els.inputError.textContent = err.message;
    } finally {
      stopPolling();
      regenerating = false;
      renderThread();
    }
  }

  async function updateAnalysisFromConversation() {
    if (updatingAnalysis || !submissionId) return;
    updatingAnalysis = true;
    els.updateAnalysisBtn.disabled = true;
    els.inputError.textContent = "";
    showThinking("Updating analysis from this conversation…");
    startPolling(() => contractFetch(`/api/admin/submissions/${submissionId}/chat/update-analysis/progress`));

    try {
      const outcome = await contractFetch(`/api/admin/submissions/${submissionId}/chat/update-analysis`, { method: "POST" });
      messages.push({ role: "analysis", content: outcome, source: "conversation_update", createdAt: new Date().toISOString() });
    } catch (err) {
      els.inputError.textContent = err.message;
    } finally {
      stopPolling();
      removeThinking();
      updatingAnalysis = false;
      els.updateAnalysisBtn.disabled = false;
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

    // Wrapped in arrow functions, not passed directly as the listener —
    // addEventListener would otherwise hand sendMessage the click/keydown
    // Event object as its first argument, which is truthy and would be
    // misread as `research: true` on every plain Send.
    els.sendBtn.addEventListener("click", () => sendMessage(false));
    els.researchSendBtn.addEventListener("click", () => sendMessage(true));
    els.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(false);
      }
    });

    contractFetch("/api/admin/chat/research-status")
      .then((data) => {
        researchAvailable = Boolean(data && data.available);
        els.researchSendBtn.hidden = !researchAvailable;
      })
      .catch(() => {
        // Leave it hidden — a failed check is the same as "not available"
        // from the UI's point of view.
      });

    els.pasteToggle.addEventListener("click", () => {
      els.pastePanel.hidden = !els.pastePanel.hidden;
      if (!els.pastePanel.hidden) els.pasteInput.focus();
    });
    els.pasteCancel.addEventListener("click", resetPasteForm);
    els.pasteSubmit.addEventListener("click", submitPaste);
    els.updateAnalysisBtn.addEventListener("click", updateAnalysisFromConversation);

    els.thread.addEventListener("click", (e) => {
      const saveBtn = e.target.closest("[data-save-msg-index]");
      if (saveBtn) {
        saveScopedAnalysis(Number(saveBtn.dataset.saveMsgIndex));
        return;
      }
      if (e.target.closest(".chat-save-standalone-btn")) {
        saveStandaloneAnalysis();
        return;
      }
      const copyBtn = e.target.closest("[data-copy-index]");
      if (copyBtn) {
        copyMessage(Number(copyBtn.dataset.copyIndex), copyBtn);
        return;
      }
      const retryBtn = e.target.closest("[data-retry-index]");
      if (retryBtn) {
        retryLastReply(retryBtn);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
