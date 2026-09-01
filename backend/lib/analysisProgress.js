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

function keyFor(kind, submissionId) {
  return `${kind}:${submissionId}`;
}

function start(kind, submissionId, meta = {}) {
  runs.set(keyFor(kind, submissionId), {
    stage: "preparing",
    startedAt: Date.now(),
    model: meta.model || null,
  });
}

function setStage(kind, submissionId, stage) {
  const key = keyFor(kind, submissionId);
  const existing = runs.get(key);
  if (!existing) return; // finished or never started — a late/stray call, ignore
  existing.stage = stage;
}

function get(kind, submissionId) {
  return runs.get(keyFor(kind, submissionId)) || null;
}

function finish(kind, submissionId) {
  runs.delete(keyFor(kind, submissionId));
}

module.exports = { start, setStage, get, finish };
