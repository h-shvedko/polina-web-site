# ADR-0000: Architecture Decision Record Index

**Project:** Polina Shvedko Artist Website (`polina-shvedko.art`)
**Maintained by:** Hennadii Shvedko

This file is the canonical index of all ADRs for this project.
Each ADR documents a significant decision, analysis, or implementation plan.

---

## Status Key

| Status | Meaning |
|---|---|
| **Active** | Decision is current and in effect |
| **Implemented** | Fully built and deployed |
| **Partially Implemented** | Some items done, remainder tracked as open |
| **Superseded** | Replaced by a later ADR (link provided) |
| **Proposed** | Under discussion, not yet committed |
| **N/A** | Decided not to pursue |

---

## ADR Registry

| ADR | Title | Status | Date | Summary |
|---|---|---|---|---|
| [ADR-0001](ADR0001-ga4-analysis-and-recommendations.md) | GA4 Analytics Analysis & Growth Recommendations | Partially Implemented | 2026-04-15 | 90-day GA4 analysis; conversion tracking, JSON-LD, SEO, CI/CD deploy, bot guidance |
| [ADR-0002](ADR0002-ux-feature-backlog.md) | UX & Feature Backlog | Partially Implemented | 2026-04-15 | Sticky nav, popup inquiry, gallery filtering, artwork year, blog system |
| [ADR-0003](ADR0003-seo-rebuild-artwork-pages.md) | SEO Rebuild — One Page per Artwork, No Tilda, No Shop | Implemented on branch adr-0003-seo-rebuild (not deployed) | 2026-10-03 | Artwork pages under medium hubs, remove Tilda, cart, prices and blog; image, redirect, sitemap and consent fixes |

---

## ADR-0001 — Implementation Tracker

| Item | Status |
|---|---|
| 1.1 Track `contact_click` GA4 event | **Done** — `src/js/analytics.js` |
| 1.2 Track `artwork_view` on popup open | **Superseded by ADR-0003** — no popups any more; every artwork has its own page (GA4 page views) |
| 1.3 Track cart interactions (`cart_order`, `purchase_inquiry`) | **Superseded by ADR-0003** — the cart was removed; `contact_click` is the only lead event |
| 2 — Instagram UTM tagging for bio link | **N/A** — removed from scope |
| 3 — Mobile hero background fix | **Done**; the hero was rebuilt by ADR-0003 (`src/templates/partials/hero.mustache`: poster image, video on click) |
| 4.1 JSON-LD VisualArtwork structured data | **Done**, rebuilt by ADR-0003 — one `VisualArtwork` per artwork page, built in `scripts/build-site.js` |
| 4.2 Descriptive `<title>` and `<meta description>` | **Done**, rebuilt by ADR-0003 — per page (`src/templates/partials/head.mustache`, rules in `scripts/build-site.js`) |
| 4.3 Blog system | **Superseded by ADR-0003** — blog removed; `/blog/` → 301 `/`, `/blog/cap-dantibes/` → 301 to the Cap d'Antibes artwork page |
| 5.1 Newsletter signup | **N/A** — removed from scope |
| 5.2 Instagram feed embed | **N/A** — removed from scope |
| 6 — Suppress bot traffic in GA4 (Columbus/Prineville) | **Open** — see guidance below |
| Mark `contact_click` as Key Event in GA4 Admin | **Open** — see guidance below |
| GitHub Actions CI/CD deploy workflow | **Done** — `.github/workflows/deploy.yml` (SFTP via lftp) |

### Guidance: Mark `contact_click` as a GA4 Key Event

1. Go to [analytics.google.com](https://analytics.google.com) → select property **Polina Shvedko Art**
2. Left sidebar → **Admin** (gear icon, bottom left)
3. Under **Data display** → **Events**
4. Find `contact_click` in the events list (it appears once someone has clicked the email link)
5. Click the toggle in the **Mark as key event** column → confirm
6. (Retired: `artwork_view` no longer exists after ADR-0003. Unmark `purchase_inquiry` / `cart_order` if they are key events.)

Key events appear in the **Conversions** report and can be used as goals in GA4 Explore.

### Guidance: Suppress bot traffic in GA4 (Columbus OH / Prineville OR)

These are AWS (Prineville) and Meta (Columbus) infrastructure locations generating near-zero-engagement sessions.

**Option A — IP filter (recommended):**
1. GA4 Admin → **Data Streams** → select your stream → **Configure tag settings**
2. **Define internal traffic** → **Create** → add IP ranges for known bot ASNs
   - This requires knowing the actual IPs from your server access log, not just the city

**Option B — Audience exclusion in reports:**
1. In any Exploration report → click **+** next to Filters
2. Add filter: `City` does not contain `Columbus` AND `City` does not contain `Prineville`
3. Save this exploration as a template for regular use

**Option C — Enable "Google signals" bot filtering:**
1. GA4 Admin → **Data collection and modification** → **Data collection**
2. Enable **Google signals data collection** (already on for most properties)
3. GA4 Admin → **Data Settings** → **Data Filters** → check if "Internal Traffic" filter is active

The simplest immediate action is Option B for reporting; Option A permanently removes them from all data.

---

## ADR-0002 — Implementation Tracker

| Item | Status |
|---|---|
| H1 — Sticky navigation menu | **Done**, rebuilt by ADR-0003 — `src/templates/partials/nav.mustache` + `src/css/site.css` + `src/js/nav.js` |
| H2 — Inquire button in artwork popup | **Superseded by ADR-0003** — the "Ask about this work" / "Contact the artist" button on each artwork page (mailto with the title in the subject) |
| H3 — Gallery filtering (Available / Sold / All) | **Superseded by ADR-0003** — filter removed; the medium hub pages replace it |
| M1 — Exhibition / CV section | **N/A** — removed from scope |
| M2 — Commission request section | **N/A** — removed from scope |
| M3 — Artwork creation year in data.json | **Done** — `year` field on all 30 artworks in `data.json`; shown on each artwork page |
| B1 — Additional Etsy photos for 5 pastel artworks | **N/A** — removed from scope |

### Blog System Architecture (retired by ADR-0003)

**Retired.** ADR-0003 removed the blog: these files no longer exist, `/blog/` answers 301 to `/` and
`/blog/cap-dantibes/` answers 301 to `/oil-paintings/affectionate-farewell-cap-dantibes/`. The post text is stored
as the (unpublished) story of that artwork. The description below is history only; do not follow it.

Static HTML blog with no framework or backend. All pages are pre-generated by the existing Gulp/Mustache pipeline.

**Files:**
- `src/templates/blog/index.html` → `app/blog/index.html` — blog listing page
- `src/templates/blog/[slug]/index.html` → `app/blog/[slug]/index.html` — individual posts
- `src/templates/partials/blog_head.html` — shared blog page head (GA, fonts, nav)
- `src/templates/partials/blog_footer.html` — shared footer
- `src/css/blog.css` — blog styles (listing cards, post layout)
- `data.json → blog_posts[]` — post metadata for the listing page

**Adding a new blog post:**
1. Add an entry to `blog_posts[]` in `data.json` (slug, title, date, excerpt, preview image, tags)
2. Create `src/templates/blog/[slug]/index.html` — write the post HTML, include nav manually (no Mustache partial loops on individual post pages)
3. Run `npx gulp html css` to rebuild
4. Push to main → CI deploys automatically

**URL structure:** `/blog/` (listing), `/blog/cap-dantibes/` (post) — clean URLs, no `.html` extension

---

## ADR-0003 — Implementation Tracker

Status: implemented on the branch `adr-0003-seo-rebuild`, **not deployed**. The full tracker, the defaults chosen
for the open questions and the slug list are in [ADR-0003 → Implementation](ADR0003-seo-rebuild-artwork-pages.md#implementation-branch-adr-0003-seo-rebuild).

| Item | Status |
|---|---|
| One page per artwork (30), three medium hubs, about, contact, custom 404 | **Done** — `scripts/build-site.js`, `src/templates/pages/` |
| Old framework, shop and blog code removed | **Done** — checked by `npm run test:static` |
| Redirects and hosting files (`src/static/.htaccess`, `robots.txt`) | **Done** — one hop for every tested form (also without the trailing slash, through `http://`/`www.`, with repeated slashes), `Cache-Control` for what Apache serves; tested on Apache 2.4 with a TLS listener and with `X-Forwarded-Proto` (`npm run test:apache`) |
| Sitemap with every page (36 URLs) | **Done** |
| Image pipeline (WebP/JPEG 600/900/1200/1920, + 160/320 for gallery thumbnails and 2560/3200 for the wide card; originals not deployed) | **Done** — `scripts/images.js`, `src/img/manifest.json`; `sizes` follow the drawn size of cropped images |
| Consent before analytics (Accept / Decline, Consent Mode v2) | **Done** — `src/js/consent.js`; banner text needs owner approval |
| Structured data (`Person`, `VisualArtwork`, `CollectionPage`, breadcrumbs) | **Done** — validator.schema.org: 0 errors, 0 warnings on one page per type (2026-10-04); Google's Rich Results Test (needs a login): **owner** |
| Tests (`npm test`: static, browser, Apache) | **Done** — CI runs the static checks before every deploy |
| Slugs, sizes, media, hub texts, Cap d'Antibes story, consent text | **Owner approval** |
| Impressum and privacy policy | **Owner** — legal text needed; pages are generated once it is in `data.json` |
| Release (merge to `main` = deploy), keep Plesk's "Serve static files directly by nginx" off (nginx passes every request to Apache, so the `.htaccess` covers everything), one-time LF refresh of the main checkout, Search Console and GA4 steps | **Owner** |
| Measure with `/seo-report` three weeks after the release | **Owner** |

---

## Adding a New ADR

1. Name the file `ADR{NNNN}-short-title.md` (zero-padded, e.g. `ADR0003-...`)
2. Use the frontmatter: `Date`, `Status`
3. Add a row to the registry table above
4. Add an implementation tracker section if the ADR has actionable items
