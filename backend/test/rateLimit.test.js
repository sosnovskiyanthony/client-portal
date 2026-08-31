const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { analysisLimiter } = require("../middleware/rateLimit");

// Tests the exact same limiter instance/config used on the real
// POST /api/admin/submissions/:id/analyze route (see routes/admin.js),
// mounted in isolation so this runs in milliseconds instead of requiring
// 21 real (admin-authenticated, AI-calling) requests against a live server.
test("analysisLimiter blocks a client after its request cap (max 20/hour)", async () => {
  const app = express();
  app.post("/analyze", analysisLimiter, (req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  const port = server.address().port;

  try {
    let lastStatus;
    for (let i = 0; i < 21; i++) {
      const res = await fetch(`http://localhost:${port}/analyze`, { method: "POST" });
      lastStatus = res.status;
      if (i < 20) assert.equal(res.status, 200, `request ${i + 1} should succeed (under the cap)`);
    }
    assert.equal(lastStatus, 429, "the 21st request in the window must be rate-limited");
  } finally {
    server.close();
  }
});
