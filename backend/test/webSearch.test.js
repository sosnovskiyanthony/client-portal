// Unit tests for services/webSearch.js — the Brave Search API wrapper
// backing the AI chat feature's "Research this" action. Mocked fetch, same
// pattern as test/ollamaProvider.test.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const { AiAnalysisError } = require("../ai/errors");

function withMockedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

// env.braveApiKey is read once at require-time by config/env.js from
// process.env — set it before requiring services/webSearch.js so the
// module under test actually sees a key configured.
function withBraveKey(key, fn) {
  const original = process.env.BRAVE_API_KEY;
  process.env.BRAVE_API_KEY = key;
  delete require.cache[require.resolve("../config/env")];
  delete require.cache[require.resolve("../services/webSearch")];
  const webSearch = require("../services/webSearch");
  return fn(webSearch).finally(() => {
    if (original === undefined) delete process.env.BRAVE_API_KEY;
    else process.env.BRAVE_API_KEY = original;
    delete require.cache[require.resolve("../config/env")];
    delete require.cache[require.resolve("../services/webSearch")];
  });
}

test("braveSearch throws missing_api_key when BRAVE_API_KEY is unset", async () => {
  await withBraveKey("", async (webSearch) => {
    await assert.rejects(
      () => webSearch.braveSearch("vegan bakery seo"),
      (err) => err instanceof AiAnalysisError && err.code === "missing_api_key"
    );
  });
});

test("isConfigured reflects whether BRAVE_API_KEY is set", async () => {
  await withBraveKey("test-key", async (webSearch) => {
    assert.equal(webSearch.isConfigured(), true);
  });
  await withBraveKey("", async (webSearch) => {
    assert.equal(webSearch.isConfigured(), false);
  });
});

test("braveSearch returns an empty array for a blank query without making a request", async () => {
  await withBraveKey("test-key", async (webSearch) => {
    let called = false;
    await withMockedFetch(
      async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({ web: { results: [] } }) };
      },
      async () => {
        const results = await webSearch.braveSearch("   ");
        assert.deepEqual(results, []);
      }
    );
    assert.equal(called, false);
  });
});

test("braveSearch maps a well-formed response to title/url/snippet, passing the API key as a header", async () => {
  await withBraveKey("test-key", async (webSearch) => {
    let capturedHeaders;
    await withMockedFetch(
      async (url, opts) => {
        capturedHeaders = opts.headers;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            web: {
              results: [
                { title: "Local SEO Guide", url: "https://example.com/seo", description: "A guide to local SEO." },
              ],
            },
          }),
        };
      },
      async () => {
        const results = await webSearch.braveSearch("local seo for bakeries");
        assert.equal(results.length, 1);
        assert.equal(results[0].title, "Local SEO Guide");
        assert.equal(results[0].url, "https://example.com/seo");
        assert.equal(results[0].snippet, "A guide to local SEO.");
      }
    );
    assert.equal(capturedHeaders["X-Subscription-Token"], "test-key");
  });
});

test("braveSearch truncates an oversized snippet", async () => {
  await withBraveKey("test-key", async (webSearch) => {
    const longDescription = "x".repeat(1000);
    await withMockedFetch(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ web: { results: [{ title: "T", url: "https://example.com", description: longDescription }] } }),
      }),
      async () => {
        const results = await webSearch.braveSearch("query");
        assert.ok(results[0].snippet.length < longDescription.length);
        assert.ok(results[0].snippet.endsWith("…"));
      }
    );
  });
});

test("braveSearch classifies a 401/403 as invalid_api_key", async () => {
  await withBraveKey("bad-key", async (webSearch) => {
    await withMockedFetch(
      async () => ({ ok: false, status: 401 }),
      async () => {
        await assert.rejects(
          () => webSearch.braveSearch("query"),
          (err) => err instanceof AiAnalysisError && err.code === "invalid_api_key"
        );
      }
    );
  });
});

test("braveSearch classifies a 429 as rate_limited", async () => {
  await withBraveKey("test-key", async (webSearch) => {
    await withMockedFetch(
      async () => ({ ok: false, status: 429 }),
      async () => {
        await assert.rejects(
          () => webSearch.braveSearch("query"),
          (err) => err instanceof AiAnalysisError && err.code === "rate_limited"
        );
      }
    );
  });
});

test("braveSearch classifies any other non-ok status as provider_error", async () => {
  await withBraveKey("test-key", async (webSearch) => {
    await withMockedFetch(
      async () => ({ ok: false, status: 500 }),
      async () => {
        await assert.rejects(
          () => webSearch.braveSearch("query"),
          (err) => err instanceof AiAnalysisError && err.code === "provider_error"
        );
      }
    );
  });
});

test("braveSearch caps results at maxResults even if the API returns more", async () => {
  await withBraveKey("test-key", async (webSearch) => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, url: `https://example.com/${i}`, description: "d" }));
    await withMockedFetch(
      async () => ({ ok: true, status: 200, json: async () => ({ web: { results: manyResults } }) }),
      async () => {
        const results = await webSearch.braveSearch("query", { maxResults: 3 });
        assert.equal(results.length, 3);
      }
    );
  });
});
