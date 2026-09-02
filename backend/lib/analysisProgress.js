// In-memory stage tracker for AI analysis/email-draft runs — lets the
// dashboard show real, backend-confirmed progress ("preparing", "sending",
// "generating", "validating", "saving") instead of a single static
// "Analyzing…" label for the whole (potentially minutes-long) request. See
// ai/README.md's "Live analysis progress" section.
//
// Deliberately in-memory, not persisted to Postgres: this is throwaway,
// second-by-second UI state, not data — losing it on a restart just means
// the dashboard falls back to the elapsed-time counter alone (see
// admin.js), which is a fine degrade, not a bug. In-memory is also only
// correct because this app runs as a single Railway instance; if it ever
// scaled horizontally, this would need to move to something shared (e.g. a
// DB row) since a poll could land on a different instance than the one
// running the request.
const runs = new Map();

// How long a completed outcome (see complete() below) stays retrievable via
// get() before being evicted — bounds memory for a result nobody ever polls
// for again (browser closed, tab navigated away). Polling happens every
// second in practice (see frontend/js/chat.js), so this is generous margin,
// not a tight budget.
const RESULT_TTL_MS = 5 * 60 * 1000;

function keyFor(kind, submissionId) {
  return `${kind}:${submissionId}`;
}

function start(kind, submissionId, meta = {}) {
  runs.set(keyFor(kind, submissionId), {
    status: "active",
    stage: "preparing",
    startedAt: Date.now(),
    model: meta.model || null,
  });
}

function setStage(kind, submissionId, stage) {
  const key = keyFor(kind, submissionId);
  const existing = runs.get(key);
  if (!existing || existing.status !== "active") return; // finished or never started — a late/stray call, ignore
  existing.stage = stage;
}

function get(kind, submissionId) {
  return runs.get(keyFor(kind, submissionId)) || null;
}

// Ends a run with nothing retrievable afterward — for callers that hold a
// live HTTP response and write the outcome to it directly themselves
// (chat replies, analysis updates). The poll is purely a "still working"
// label for these; there's nothing more for get() to return once it's gone.
function finish(kind, submissionId) {
  runs.delete(keyFor(kind, submissionId));
}

// Ends a run and keeps its outcome available via get() for RESULT_TTL_MS —
// for callers with no live HTTP response to write to at all, because they
// run the actual work in the background and respond to the request that
// started them immediately (see chatController.js's paste-and-analyze
// routes). `outcome` is caller-defined; get() just hands it back verbatim
// alongside status:"done".
function complete(kind, submissionId, outcome) {
  const key = keyFor(kind, submissionId);
  const completedAt = Date.now();
  runs.set(key, { status: "done", outcome, completedAt });
  setTimeout(() => {
    const current = runs.get(key);
    if (current && current.status === "done" && current.completedAt === completedAt) {
      runs.delete(key);
    }
  }, RESULT_TTL_MS).unref();
}

module.exports = { start, setStage, get, finish, complete };
