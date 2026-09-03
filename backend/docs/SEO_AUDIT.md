# BrindLeaf SEO Audit

Internal technical SEO audit — international custom web design/development/SEO/AI-integration studio positioning, not local SEO. Covers the public marketing site only (`/`, `/web-design`, `/seo`, `/ai-integration`, `/app-building`, `/web-management`, `/contact`); admin/API surfaces are audited only for the negative case (must stay non-indexable and authenticated).

Two implementation rounds are reflected here: an earlier crawlability pass (clean URLs, sitemap, robots.txt, breadcrumbs — already live) and this round (homepage H1, structured-data entity linking, `seo.html` content depth, accessibility verification, automated regression tests).

Every finding below is labeled **VERIFIED** (confirmed via code, live HTTP behavior, or an automated tool run in this session), **INFERRED** (a reasonable conclusion from the implementation, not independently measured), or **UNVERIFIED** (requires external data this session has no access to — Search Console, real-user Core Web Vitals, backlinks). Scores are not awarded merely because a feature exists on paper.

---

## 1. Score — before this round

| Category | Points | Score |
|---|---|---|
| Crawlability & Indexation | 15 | **15** |
| Technical SEO | 15 | **13** |
| On-Page SEO | 15 | **13** |
| Content & Search Intent | 15 | **10** |
| Information Architecture & Internal Linking | 10 | **9** |
| Performance / Core Web Vitals | 10 | **7** |
| Structured Data / Machine Readability | 5 | **4** |
| Accessibility | 5 | **4** |
| International / AI Search Readiness | 5 | **3** |
| Authority / E-E-A-T Signals | 5 | **2** |
| **TOTAL** | **100** | **80** |

## 2. Score — after this round

| Category | Points | Score |
|---|---|---|
| Crawlability & Indexation | 15 | **15** |
| Technical SEO | 15 | **13** |
| On-Page SEO | 15 | **14** |
| Content & Search Intent | 15 | **11** |
| Information Architecture & Internal Linking | 10 | **9** |
| Performance / Core Web Vitals | 10 | **8** |
| Structured Data / Machine Readability | 5 | **5** |
| Accessibility | 5 | **5** |
| International / AI Search Readiness | 5 | **4** |
| Authority / E-E-A-T Signals | 5 | **2** |
| **TOTAL** | **100** | **86** |

**86/100 is not claimed as a real-world ranking score — it measures technical/semantic/structural readiness, not actual search visibility.** See §9 for exactly what remains unverifiable without Google Search Console access. Authority (2/5) is the honest ceiling: no real case studies, backlinks, or third-party mentions exist anywhere in the codebase to point to, and none were fabricated to inflate the number.

---

## 3. Issue log

| # | Severity | URL/Area | Issue | Fix applied | Status |
|---|---|---|---|---|---|
| 1 | HIGH | site-wide | No clean/extensionless URLs (`/web-design.html` instead of `/web-design`) | Added `CLEAN_URL_PAGES`-driven routes + single-hop 301s from every legacy `.html` URL (server.js) | Fixed (prior round) |
| 2 | HIGH | `robots.txt` | Only `/admin.html` disallowed; `/admin-contracts.html`, `/admin-security.html`, `/api/` unlisted | Added all three disallow lines | Fixed (prior round) |
| 3 | HIGH | `sitemap.xml` | Missing `ai-integration`, `app-building`, `web-management` entirely | Rebuilt as dynamically generated from one source-of-truth page list — same list used by the clean-URL routes, so it can't drift out of sync with reality again | Fixed (prior round) |
| 4 | MEDIUM | `/index.html` | Served identical content to `/` with no redirect (soft duplicate, canonical-only mitigation) | Added to the legacy-redirect map — 301 to `/` | Fixed (prior round) |
| 5 | MEDIUM | clean URLs (`/web-design/`) | Trailing slash on any new clean-URL route 500'd (Express matched the route but `req.path` retained the slash, which the route lookup didn't account for) | General trailing-slash → canonical-form 301 redirect, applied site-wide | Fixed (prior round) |
| 6 | LOW | site footer | Footer linked only to Contact; every other public page reachable solely via nav | Footer now links all 7 public pages | Fixed (prior round) |
| 7 | LOW | all 6 service pages | No `BreadcrumbList` structured data | Added, matching real nav depth (Home → Service) | Fixed (prior round) |
| 8 | MEDIUM | homepage H1 | H1 ("Websites built with the same obsession...") didn't state the primary topic; relied on title tag + surrounding copy alone | Rewrote to lead with "Custom web design & development," keeping the original line as the emotional payoff of the same sentence — same element, same visual size, no new markup | Fixed (this round) |
| 9 | LOW | Organization/Service JSON-LD | Each service page duplicated a full inline `Organization` object as `provider` instead of referencing one canonical entity | Homepage `Organization` now carries `@id`; every service page's `provider` is a `{"@id": ...}` reference to it — standard JSON-LD entity linking | Fixed (this round) |
| 10 | LOW | structured data | No `WebPage` type on any page; Organization schema had no `areaServed`/`knowsAbout` | Added `WebPage` (with `isPartOf`/`about` links) to all 7 pages; added `areaServed: "Worldwide"` (truthful for a remote studio) and `knowsAbout` (the site's actual, already-used service names — nothing invented) to Organization | Fixed (this round) |
| 11 | MEDIUM | `/seo` | Thinnest page (378 words), no FAQ section/schema unlike its 4 sibling service pages — it's a combined marketing+intake page, not a pure marketing page like `/web-design` | Added a 5-question FAQ section (visible HTML + matching `FAQPage` schema) covering what the review covers, data-access requirements, one-time-vs-ongoing, "I'm getting a new site, do I still need this," and pricing — 378 → 656 words | Fixed (this round) |
| 12 | — | site-wide | No automated regression coverage for any of the above | Added `test/seo.test.js` (43 tests): per-page title/description/canonical/H1/lang/OG/Twitter/schema-vs-visible-content checks, cross-page title/description uniqueness, legacy-redirect single-hop checks, trailing-slash checks, noindex/admin/API auth checks, 404 checks, robots.txt/sitemap.xml correctness, orphan-page check | Fixed (this round) |
| 13 | LOW | `/about`, `/work` | No About page (company/founder context) or Work/case-study page | **Not built.** No real founder bio, project history, or case-study data exists anywhere in the codebase or database (checked `models/ProjectOutcome.js` specifically — it's private internal pricing/scope tracking tied to real client submissions, not publishable case-study content, and must never be exposed publicly). Building either page now would mean inventing content, which was explicitly out of bounds. | **Open** — needs real input from you (see §10) |
| 14 | LOW | site-wide | CSS (84KB) and JS (largest file ~68KB) are unminified — no build step exists in this project by design | **Not changed.** Minifying by hand isn't meaningful, and introducing a build pipeline is a materially different architecture decision than an SEO pass — flagged, not implemented unprompted. Real-world impact is already small: Cloudflare serves everything Brotli-compressed (verified), and there are no render-blocking third-party scripts. | **Open** — recommended future work |
| 15 | LOW | Organization logo | `logo` is a 32×32 SVG mark — valid per current schema.org/Google guidance, but a dedicated square raster logo (≥112×112) is the more conservative choice for Knowledge Panel eligibility | **Not changed** — this is a brand-asset decision, not something to generate unprompted | **Open** — recommended future work |

---

## 4. What "VERIFIED" actually covers this round

- **Automated crawl + schema validation**: `test/seo.test.js`, 43/43 passing, run against the real Express server over real HTTP (not mocked) — title/description/canonical/H1/lang/OG/Twitter per page, JSON-LD parses and, for every `FAQPage` block, each question's `name` is checked to actually appear as visible HTML (a concrete anti-fabrication check, not just "is it valid JSON").
- **Accessibility**: real automated scan (`axe-core` 4.x via headless Chromium, WCAG 2.0/2.1/2.2 AA rule sets) across all 7 public pages — **0 violations on every page.** `color-contrast` came back `incomplete` (axe couldn't auto-resolve it, most likely due to the gradient/`backdrop-filter` elements like the eyebrow pill and gradient headline text, which axe's contrast heuristic can't always evaluate) on 14–19 elements per page — not a failure, but not a clean pass either, so accessibility is scored 5/5 on "no confirmed violations + strong underlying token contrast" rather than "certified AAA." Independently, I computed WCAG contrast ratios directly from the CSS custom properties: `--text-primary` 18.1:1, `--text-secondary` 7.76:1, `--text-tertiary` 5.81:1, `--accent-1` 6.67:1 against `--bg` — all comfortably clear of the 4.5:1 AA floor (one, `--text-tertiary`, has an existing code comment recording that it was previously failing at 3.78:1 and was already fixed before this session).
- **Compression**: confirmed via direct request to production — `content-encoding: br` on HTML responses.
- **Security boundary**: confirmed unauthenticated `GET /api/admin/submissions` still 401s, and an unknown `/api/*` path still 404s as JSON (not the branded HTML 404) — both now also asserted in the automated suite, so this can't silently regress.
- **Live production**: the prior round's changes (clean URLs, redirects, sitemap, robots.txt) were independently re-verified directly against `https://brindleaf.com` after deploy, including a Cloudflare edge-cache issue on `robots.txt` specifically (origin was correct; the edge cache caught up on its own TTL) — noted at the time, not relevant to this round's changes.

## 5. What's INFERRED, not verified

- **Performance**: no images (zero `<img>` tags site-wide — confirmed by grep, not inferred), small script/style payload, fonts loaded with `preconnect` + `font-display: swap`, scripts placed at end of `<body>`, GA is consent-gated and only loaded after opt-in. This strongly *suggests* good Core Web Vitals, but no Lighthouse run or real-user field data was collected this session (no Lighthouse/Chrome CLI available in this environment, and field data requires Search Console/CrUX access this session doesn't have) — see §9.
- **On-page topical clarity**: the homepage H1 change and `/seo` content expansion are reasoned, not measured, improvements — there's no way to verify they move a ranking without real search data.

## 6. What was explicitly NOT done, and why

- **No location/city pages, no local SEO** — matches the explicit international-only positioning; nothing here targets Rochester, New York, or any other geography.
- **No fabricated content** — no invented clients, testimonials, awards, statistics, years-in-business claims, or case studies. Where genuine content doesn't exist (About, Work), the page was not built rather than filled with placeholder copy.
- **No `sameAs` social links** — no real BrindLeaf social profiles exist anywhere in the codebase; adding placeholder/guessed URLs would have been fabrication.
- **No hreflang** — correctly omitted; no translated/regional page variants exist, and creating machine-translated duplicates was explicitly out of scope.
- **No new build pipeline / CSS-JS minification** — this project has no build step by design (static HTML/CSS/vanilla JS, no bundler); adding one is an architecture decision beyond an SEO pass's mandate.

---

## 7. Structured data implemented

`Organization` (with `@id`, `areaServed`, `knowsAbout`) · `WebSite` · `WebPage` (per page) · `Service` (per service page, `provider` referencing the Organization `@id`) · `FAQPage` (5 of 6 service pages, matching real visible accordion content) · `BreadcrumbList` (all 6 service pages). All validated as parseable JSON in the automated suite; `FAQPage` content is additionally checked against visible HTML.

## 8. Accessibility summary

0 axe-core violations across all 7 public pages (WCAG 2.0/2.1/2.2 A+AA rule sets). Semantic landmarks (`<header>`, `<nav>`, `<main>`, `<section>`, `<footer>`) present; single H1 per page with logical H2→H3 nesting; 22 `:focus-visible` rules covering every interactive control type on the site; `prefers-reduced-motion` respected; real `<label>` elements on every form field; extensive ARIA (`aria-expanded`/`aria-controls` on the FAQ accordions, `aria-modal`/`role="dialog"` on the auth modal, `aria-live` regions for async state). `color-contrast` axe checks are `incomplete` (inconclusive, not failing) on several elements — recommend a manual pass with a contrast-checker on the eyebrow pill and gradient headline text specifically, since those are the elements axe couldn't auto-resolve.

## 9. What Google Search Console / external tools would need to confirm (this session has no access to any of these)

- Whether any of these pages are actually **indexed** by Google (crawlable ≠ indexed)
- Real impressions, clicks, average position, and CTR — branded (`BrindLeaf`) vs. non-branded (`custom web design`, `SEO consulting`, etc.) queries
- Real-user Core Web Vitals (field data) — LCP/INP/CLS as actually experienced by visitors, not lab-inferred
- International vs. domestic impression/click split
- Any crawl errors or manual actions Google itself has flagged
- Backlink count, referring domains, or any third-party authority signal
- Domain age/history in Google's eyes

**Recommendation**: connect Google Search Console (`search.google.com/search-console`, verify via DNS TXT record or the existing HTML-file-upload method) and Bing Webmaster Tools. Neither is currently connected — I did not fabricate verification tags for either, since a fake one would just fail silently.

## 10. Recommended future work (ranked)

1. **Connect Google Search Console + Bing Webmaster Tools** — the single highest-value next step; without it, every claim in §9 stays permanently unverifiable, no matter how much more code changes.
2. **A real About page**, once you're willing to share actual founder/company background — even 150 honest words materially helps E-E-A-T and is currently the single biggest score-limiting gap (Authority: 2/5).
3. **A real Work/case-studies page**, once at least one client has agreed their project can be shown publicly — architecture (`/work` clean URL, a project-page template) can be added quickly once there's real content to put in it.
4. Manual contrast check on the `.eyebrow` pill and gradient headline text (the axe-inconclusive elements from §8).
5. A dedicated square (≥112×112) raster logo for the Organization schema's `logo` field, if you want stronger Knowledge Panel eligibility than the current SVG mark provides.
6. A real Lighthouse/PageSpeed Insights run against the live production URL (I don't have that tooling in this environment — you can run `https://pagespeed.web.dev/analysis?url=https://brindleaf.com` directly in about 30 seconds).
