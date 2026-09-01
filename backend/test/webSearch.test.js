// Unit tests for services/webSearch.js — the Tavily Search API wrapper
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

// env.tavilyApiKey is read once at require-time by config/env.js from
// process.env — set it before requiring services/webSearch.js so the
// module under test actually sees a key configured.
function withTavilyKey(key, fn) {
  const original = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = key;
  delete require.cache[require.resolve("../config/env")];
  delete require.cache[require.resolve("../services/webSearch")];
  const webSearch = require("../services/webSearch");
  return fn(webSearch).finally(() => {
    if (original === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = original;
    delete require.cache[require.resolve("../config/env")];
    delete require.cache[require.resolve("../services/webSearch")];
  });
}

test("tavilySearch throws missing_api_key when TAVILY_API_KEY is unset", async () => {
  await withTavilyKey("", async (webSearch) => {
    await assert.rejects(
      () => webSearch.tavilySearch("vegan bakery seo"),
      (err) => err instanceof AiAnalysisError && err.code === "missing_api_key"
    );
  });
});

test("isConfigured reflects whether TAVILY_API_KEY is set", async () => {
  await withTavilyKey("test-key", async (webSearch) => {
    assert.equal(webSearch.isConfigured(), true);
  });
  await withTavilyKey("", async (webSearch) => {
    assert.equal(webSearch.isConfigured(), false);
  });
});

test("tavilySearch returns an empty array for a blank query without making a request", async () => {
  await withTavilyKey("test-key", async (webSearch) => {
    let called = false;
    await withMockedFetch(
      async () => {
        called = true;
        return { ok: true, status: 200, json: async () => ({ results: [] }) };
      },
      async () => {
        const results = await webSearch.tavilySearch("   ");
        assert.deepEqual(results, []);
      }
    );
    assert.equal(called, false);
  });
});

test("tavilySearch maps a well-formed response to title/url/snippet, sending the key as a Bearer token and a POST body", async () => {
  await withTavilyKey("tvly-test-key", async (webSearch) => {
    let capturedUrl, capturedOpts, capturedBody;
    await withMockedFetch(
      async (url, opts) => {
        capturedUrl = url;
        capturedOpts = opts;
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [{ title: "Local SEO Guide", url: "https://example.com/seo", content: "A guide to local SEO." }],
          }),
        };
      },
      async () => {
        const results = await webSearch.tavilySearch("local seo for bakeries");
        assert.equal(results.length, 1);
        assert.equal(results[0].title, "Local SEO Guide");
        assert.equal(results[0].url, "https://example.com/seo");
        assert.equal(results[0].snippet, "A guide to local SEO.");
      }
    );
    assert.equal(capturedUrl, "https://api.tavily.com/search");
    assert.equal(capturedOpts.method, "POST");
    assert.equal(capturedOpts.headers.Authorization, "Bearer tvly-test-key");
    assert.equal(capturedBody.query, "local seo for bakeries");
  });
});

test("tavilySearch truncates an oversized snippet", async () => {
  await withTavilyKey("test-key", async (webSearch) => {
    const longContent = "x".repeat(1000);
    await withMockedFetch(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ title: "T", url: "https://example.com", content: longContent }] }),
      }),
      async () => {
        const results = await webSearch.tavilySearch("query");
        assert.ok(results[0].snippet.length < longContent.length);
        assert.ok(results[0].snippet.endsWith("…"));
      }
    );
  });
});

test("tavilySearch classifies a 401/403 as invalid_api_key", async () => {
  await withTavilyKey("bad-key", async (webSearch) => {
    await withMockedFetch(
      async () => ({ ok: false, status: 401 }),
      async () => {
        await assert.rejects(
          () => webSearch.tavilySearch("query"),
          (err) => err instanceof AiAnalysisError && err.code === "invalid_api_key"
        );
      }
    );
  });
});

test("tavilySearch classifies a 429 as rate_limited", async () => {
  await withTavilyKey("test-key", async (webSearch) => {
    await withMockedFetch(
      async () => ({ ok: false, status: 429 }),
      async () => {
        await assert.rejects(
          () => webSearch.tavilySearch("query"),
          (err) => err instanceof AiAnalysisError && err.code === "rate_limited"
        );
      }
    );
  });
});

test("tavilySearch classifies any other non-ok status as provider_error", async () => {
  await withTavilyKey("test-key", async (webSearch) => {
    await withMockedFetch(
      async () => ({ ok: false, status: 500 }),
      async () => {
        await assert.rejects(
          () => webSearch.tavilySearch("query"),
          (err) => err instanceof AiAnalysisError && err.code === "provider_error"
        );
      }
    );
  });
});

test("tavilySearch caps results at maxResults even if the API returns more", async () => {
  await withTavilyKey("test-key", async (webSearch) => {
    const manyResults = Array.from({ length: 10 }, (_, i) => ({ title: `T${i}`, url: `https://example.com/${i}`, content: "d" }));
    await withMockedFetch(
      async () => ({ ok: true, status: 200, json: async () => ({ results: manyResults }) }),
      async () => {
        const results = await webSearch.tavilySearch("query", { maxResults: 3 });
        assert.equal(results.length, 3);
      }
    );
  });
});
