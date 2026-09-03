// SEO/crawlability regression suite — real server, real HTTP, same pattern
// as test/contractIntegration.test.js. Exists so a future change (a new
// page, an edited nav link, a routing tweak) can't silently reintroduce a
// gap this app already paid to find and fix once: a missing sitemap entry,
// a duplicate title, a broken canonical, a redirect chain, an accidentally
// exposed admin route. Every page-list here (PUBLIC_PAGES etc.) is a
// second, independent copy of server.js's CLEAN_URL_PAGES — deliberately
// not imported from it, so this suite catches drift between the route
// list and reality instead of just re-asserting whatever the route list
// currently says.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

const TEST_PORT = 8797;
const BASE_URL = `http://localhost:${TEST_PORT}`;

const PUBLIC_PAGES = ["/", "/web-design", "/seo", "/ai-integration", "/app-building", "/web-management", "/contact"];
const LEGACY_HTML_URLS = [
  "/index.html",
  "/web-design-services.html",
  "/seo.html",
  "/ai-integration.html",
  "/app-building.html",
  "/web-management.html",
  "/contact.html",
];
const NOINDEX_UTILITY_PAGES = ["/web-design.html", "/services.html"];
const ADMIN_PAGES = ["/admin.html", "/admin-contracts.html", "/admin-security.html"];

let serverProcess;

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server did not become ready in time");
}

test.before(async () => {
  serverProcess = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(TEST_PORT), AI_PROVIDER: "integration-test-invalid-provider", NODE_ENV: "test" },
    stdio: "ignore",
  });
  await waitForServer(BASE_URL);
});

test.after(() => {
  serverProcess.kill();
});

async function fetchPage(urlPath) {
  const res = await fetch(`${BASE_URL}${urlPath}`, { redirect: "manual" });
  const html = res.status < 300 || res.status >= 400 ? await res.text() : "";
  return { res, html };
}

function extract(html, re) {
  const m = html.match(re);
  return m ? m[1] : null;
}

function h1s(html) {
  return [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

// ---------- Every public marketing page: the baseline every indexable page must clear ----------

for (const urlPath of PUBLIC_PAGES) {
  test(`${urlPath}: 200, unique-shaped title/description/canonical, exactly one H1, lang, no stray robots directive`, async () => {
    const { res, html } = await fetchPage(urlPath);
    assert.equal(res.status, 200);

    const title = extract(html, /<title>([^<]*)<\/title>/);
    assert.ok(title && title.includes("BrindLeaf"), `missing/malformed title on ${urlPath}`);

    const description = extract(html, /<meta name="description" content="([^"]*)"/);
    assert.ok(description && description.length > 20, `missing/too-short meta description on ${urlPath}`);

    const canonical = extract(html, /<link rel="canonical" href="([^"]*)"/);
    assert.ok(canonical, `missing canonical on ${urlPath}`);
    const expectedSuffix = urlPath === "/" ? "/" : urlPath;
    assert.ok(canonical.endsWith(expectedSuffix), `canonical "${canonical}" doesn't self-reference ${urlPath}`);

    const heading = h1s(html);
    assert.equal(heading.length, 1, `expected exactly 1 H1 on ${urlPath}, found ${heading.length}`);
    assert.ok(heading[0].length > 0, `H1 on ${urlPath} is empty`);

    assert.match(html, /<html lang="en">/, `missing <html lang="en"> on ${urlPath}`);

    const robots = extract(html, /<meta name="robots" content="([^"]*)"/);
    assert.equal(robots, null, `public page ${urlPath} must not carry a robots meta tag (found "${robots}")`);
  });

  test(`${urlPath}: Open Graph and Twitter Card metadata present and self-referencing`, async () => {
    const { html } = await fetchPage(urlPath);
    const ogTitle = extract(html, /<meta property="og:title" content="([^"]*)"/);
    const ogDescription = extract(html, /<meta property="og:description" content="([^"]*)"/);
    const ogUrl = extract(html, /<meta property="og:url" content="([^"]*)"/);
    const ogImage = extract(html, /<meta property="og:image" content="([^"]*)"/);
    const twitterCard = extract(html, /<meta name="twitter:card" content="([^"]*)"/);

    assert.ok(ogTitle, `missing og:title on ${urlPath}`);
    assert.ok(ogDescription, `missing og:description on ${urlPath}`);
    assert.ok(ogUrl && ogUrl.endsWith(urlPath === "/" ? "/" : urlPath), `og:url mismatch on ${urlPath}: "${ogUrl}"`);
    assert.ok(ogImage, `missing og:image on ${urlPath}`);
    assert.equal(twitterCard, "summary_large_image", `missing/wrong twitter:card on ${urlPath}`);
  });

  test(`${urlPath}: every JSON-LD block is valid, non-empty, and matches visible content (no fabricated schema)`, async () => {
    const { html } = await fetchPage(urlPath);
    const blocks = jsonLdBlocks(html); // JSON.parse throws (failing the test) on malformed JSON-LD
    assert.ok(blocks.length > 0, `no structured data on ${urlPath}`);

    for (const block of blocks) {
      assert.ok(block["@context"] === "https://schema.org", `JSON-LD block missing @context on ${urlPath}`);
      assert.ok(block["@type"], `JSON-LD block missing @type on ${urlPath}`);

      if (block["@type"] === "FAQPage") {
        // Every question the schema claims must actually appear as visible
        // accordion text — this is the concrete anti-fabrication check.
        for (const q of block.mainEntity) {
          assert.ok(html.includes(q.name), `FAQPage schema question "${q.name}" not found in visible HTML on ${urlPath}`);
        }
      }
    }
  });
}

// ---------- Cross-page: titles and descriptions must be unique, not duplicated ----------

test("all public pages have unique titles (no duplicate <title> across the site)", async () => {
  const titles = new Map();
  for (const urlPath of PUBLIC_PAGES) {
    const { html } = await fetchPage(urlPath);
    const title = extract(html, /<title>([^<]*)<\/title>/);
    assert.ok(!titles.has(title), `duplicate title "${title}" on both ${titles.get(title)} and ${urlPath}`);
    titles.set(title, urlPath);
  }
});

test("all public pages have unique meta descriptions (no duplicate description across the site)", async () => {
  const descriptions = new Map();
  for (const urlPath of PUBLIC_PAGES) {
    const { html } = await fetchPage(urlPath);
    const description = extract(html, /<meta name="description" content="([^"]*)"/);
    assert.ok(!descriptions.has(description), `duplicate description on both ${descriptions.get(description)} and ${urlPath}`);
    descriptions.set(description, urlPath);
  }
});

// ---------- Legacy .html URLs must redirect, single hop, to the clean URL ----------

for (const urlPath of LEGACY_HTML_URLS) {
  test(`${urlPath}: single-hop 301 redirect (never a 200, never a chain)`, async () => {
    const { res } = await fetchPage(urlPath);
    assert.equal(res.status, 301, `${urlPath} should 301, not serve content directly (duplicate-content risk)`);
    const location = res.headers.get("location");
    assert.ok(location, `${urlPath} 301 has no Location header`);
    assert.ok(PUBLIC_PAGES.includes(location), `${urlPath} redirects to "${location}", which isn't itself a final public page — possible redirect chain`);
  });
}

test("query strings survive a legacy-URL redirect (e.g. tracked campaign links)", async () => {
  const { res } = await fetchPage("/seo.html?utm_source=test&utm_medium=email");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "/seo?utm_source=test&utm_medium=email");
});

test("a trailing slash on a clean URL redirects to the slash-less canonical form", async () => {
  const { res } = await fetchPage("/web-design/");
  assert.equal(res.status, 301);
  assert.equal(res.headers.get("location"), "/web-design");
});

// ---------- Public/private separation: the actual security-relevant assertion ----------

for (const urlPath of NOINDEX_UTILITY_PAGES) {
  test(`${urlPath}: reachable (200) but explicitly noindex,nofollow — a real URL, not indexed`, async () => {
    const { res, html } = await fetchPage(urlPath);
    assert.equal(res.status, 200);
    const robots = extract(html, /<meta name="robots" content="([^"]*)"/);
    assert.equal(robots, "noindex, nofollow");
  });
}

for (const urlPath of ADMIN_PAGES) {
  test(`${urlPath}: HTML shell reachable but noindex,nofollow — actual privacy enforced by JWT-gated API, not by hiding this file`, async () => {
    const { res, html } = await fetchPage(urlPath);
    assert.equal(res.status, 200);
    const robots = extract(html, /<meta name="robots" content="([^"]*)"/);
    assert.equal(robots, "noindex, nofollow");
  });
}

test("unauthenticated /api/admin/* still requires auth — SEO changes must never weaken this", async () => {
  const res = await fetch(`${BASE_URL}/api/admin/submissions`);
  assert.equal(res.status, 401);
});

test("an unknown /api/* route 404s as JSON, not the branded HTML 404 page", async () => {
  const res = await fetch(`${BASE_URL}/api/this-does-not-exist`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(body.error);
});

// ---------- 404 handling ----------

test("a nonexistent page returns a real HTTP 404, never a soft-404 (200 with 'not found' copy)", async () => {
  const res = await fetch(`${BASE_URL}/this-page-does-not-exist-xyz`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.match(html, /<title>[^<]*Not Found[^<]*<\/title>/i);
  const robots = extract(html, /<meta name="robots" content="([^"]*)"/);
  assert.equal(robots, "noindex, nofollow");
});

// ---------- robots.txt / sitemap.xml ----------

test("robots.txt: 200, text/plain, allows /, blocks all three admin pages and /api/, references the sitemap", async () => {
  const res = await fetch(`${BASE_URL}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/plain/);
  const body = await res.text();
  assert.match(body, /Allow: \//);
  assert.match(body, /Disallow: \/admin\.html/);
  assert.match(body, /Disallow: \/admin-contracts\.html/);
  assert.match(body, /Disallow: \/admin-security\.html/);
  assert.match(body, /Disallow: \/api\//);
  assert.match(body, /Sitemap: https:\/\/[^\s]+\/sitemap\.xml/);
});

test("sitemap.xml: 200, application/xml, contains every public page's clean URL and nothing private", async () => {
  const res = await fetch(`${BASE_URL}/sitemap.xml`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/xml/);
  const body = await res.text();

  const locs = [...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  for (const urlPath of PUBLIC_PAGES) {
    assert.ok(
      locs.some((loc) => loc.endsWith(urlPath === "/" ? "/" : urlPath)),
      `sitemap.xml is missing ${urlPath}`
    );
  }
  for (const loc of locs) {
    assert.ok(!loc.includes("/admin"), `sitemap.xml must never list an admin URL, found ${loc}`);
    assert.ok(!loc.includes("/api/"), `sitemap.xml must never list an API URL, found ${loc}`);
    assert.ok(!loc.endsWith(".html"), `sitemap.xml entry "${loc}" should use the clean URL, not the legacy .html one`);
  }

  // Every listed URL must actually resolve — a sitemap entry pointing at a
  // 404/redirect is worse than not being in the sitemap at all.
  for (const loc of locs) {
    const urlPath = new URL(loc).pathname;
    const { res: pageRes } = await fetchPage(urlPath);
    assert.equal(pageRes.status, 200, `sitemap entry ${loc} does not resolve to 200`);
  }
});

// ---------- Orphan check ----------

test("every public page is reachable via an internal link from at least one other public page (no orphans)", async () => {
  const linkSets = {};
  for (const urlPath of PUBLIC_PAGES) {
    const { html } = await fetchPage(urlPath);
    linkSets[urlPath] = [...html.matchAll(/href="(\/[a-zA-Z0-9_\-#?=/.]*)"/g)].map((m) => m[1].split("#")[0].split("?")[0]);
  }
  for (const urlPath of PUBLIC_PAGES) {
    const linkedFromElsewhere = Object.entries(linkSets).some(([from, links]) => from !== urlPath && links.includes(urlPath));
    assert.ok(linkedFromElsewhere, `${urlPath} is an orphan — no other public page links to it`);
  }
});
