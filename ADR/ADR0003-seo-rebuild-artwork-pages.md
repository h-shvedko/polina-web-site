# ADR-0003: SEO Rebuild — One Page per Artwork, No Tilda, No Shop

**Date:** 2026-10-03
**Status:** Implemented on branch adr-0003-seo-rebuild (not deployed) — see [Implementation](#implementation-branch-adr-0003-seo-rebuild)
**Supersedes:** ADR-0001 item 4.3 (blog system), ADR-0002 items about the popup inquiry and the cart
**Evidence:** `/seo-report` baseline of 2026-10-03 (snapshots in `~/.local/state/polina-shvedko.art-seo/`)

---

## Context

### What the data says (baseline, 2026-10-03)

Search Console data ends 2026-09-29. GA4 covers the 90 days to 2026-10-03.

| Metric | Value | Source |
|---|---|---|
| Search clicks / impressions, 90 days | 5 / 144, average position 6.5 | Search Console |
| Search clicks / impressions, 28 days | 1 / 29 | Search Console |
| Queries with data | `polina shvedko` (4 clicks, 43 impressions, position 1.4); nothing else above 2 impressions | Search Console |
| Indexed URLs | `/`, `/blog/`; `/blog/cap-dantibes/` is "URL is unknown to Google" | URL Inspection API |
| Sitemap | 1 URL, `lastmod` 2025-04-28, last downloaded by Google 2025-10-23 | `app/sitemap.xml`, Sitemaps API |
| GA4 sessions, 90 days | 184; 99 of the 138 German sessions are bot bursts (2026-08-20, 08-21, 09-03, 00:00–04:00) | GA4 Data API |
| Real target-market sessions | about 21 daytime German sessions in 90 days | GA4 Data API |
| Leads | 0 `purchase_inquiry`, 0 `cart_order`, 0 `contact_click`; 9 `artwork_view` | GA4 Data API |
| Homepage weight | 76.1 MB desktop, 69.2 MB at 390 px; 67 MB of images; LCP 3.5 s desktop | Playwright, live site |

The site gets almost no search traffic beyond the artist's name. Google sees one page.

### Why the current architecture limits search

1. **All 30 artworks live on one URL.** Each artwork opens in a Tilda popup (`t754`, `#prodpopup`).
   A popup has no URL, so Google cannot index, rank or show a single artwork. The 30 `VisualArtwork`
   JSON-LD blocks all point to `https://polina-shvedko.art/`.
2. **The page is a Tilda export.** 952 KB of Tilda CSS/JS (`src/css/tilda-*`, `src/js/tilda-*`,
   `hammer.min.js`, `w3.js`), 17 scripts in `head.html`, inline styles, `data-tilda-*` attributes,
   the `TildaSans` font. The homepage has no `h1`–`h3`, no `<html lang>`, and 60 of 61 `<img>`
   without `alt`. Gallery images are CSS backgrounds, so image search cannot see them.
3. **There is a shop that is not used.** The Tilda cart (`t706`, ~70 cart/price references in
   `footer.html`), prices, `Offer` structured data and the meta text "Available to buy online"
   promise an e-shop. The owner does not plan one. No cart order was recorded in 90 days.
4. **The blog is one post.** `/blog/` has 76 words; `/blog/cap-dantibes/` is not indexed. The post
   is about one artwork, which is exactly what an artwork page should hold.
5. **Build and hosting defects** (from the same audit):
   - `.htaccess` is in the repo root, not in `app/`, so it never deploys: `http://` and `www.`
     answer 200 without a redirect.
   - The `html` task publishes 116 template fragments as `/partials/**.html` (200, no noindex);
     `/partials/gallery_oil.html` duplicates the homepage.
   - Google Analytics loads before consent on every page; the blog pages have no consent banner.
     The banner text "By continuing to browse, you agree" is not valid consent in Germany.
   - 25 `dimensions` values in `data.json` use the Cyrillic letter `х` (U+0445) instead of `x`.
   - "Delivery across the EU" and "Commissions welcome" appear only in the meta description.

### Owner requirements (2026-10-03)

- R1. Replace the artwork popups with a separate page for every artwork, for search indexing.
- R2. Remove all Tilda code.
- R3. No e-shop: remove everything about buying online.
- R4. Remove the blog. Artwork pages get their own HTML pages, not under `/blog/`.

---

## Decision

Rebuild the site as plain static HTML generated from `data.json`, with one indexable page per
artwork, one hub page per medium, and no Tilda, cart or blog code. Keep Gulp and Mustache.

### 1. URL structure

| Page | URL | Example |
|---|---|---|
| Home | `/` | — |
| Medium hub | `/oil-paintings/`, `/pastels/`, `/watercolours/` | `/oil-paintings/` |
| Artwork | `/<medium-hub>/<slug>/` | `/oil-paintings/affectionate-farewell-cap-dantibes/` |
| About | `/about/` | — |
| Contact | `/contact/` | — |
| Privacy / Imprint | `/privacy/`, `/imprint/` | see Open Questions |

**Why this structure (recommended):**

- The hub names match what people search for ("oil paintings", "pastels", "watercolours")
  and give each medium a landing page with real text, not only a grid.
- The artwork URL carries the medium and the subject words, and is one click from the hub.
- Click depth: home → hub → artwork = 2. Every artwork is also linked from the home page.
- Trailing slash and `index.html` in a folder: the host serves `/x/` without extra rules.
- British spelling `watercolours` matches the existing copy ("Watercolour Paintings" in the title).

**Alternatives considered:**

| Option | Why not |
|---|---|
| `/works/<slug>/` (flat) | Loses the medium hub as a search landing page; medium is fixed per artwork, so it is safe in the URL |
| `/artwork-12.html` (by `lid`) | No search words in the URL; not readable |
| Keep `/blog/<slug>/` | Rejected by R4 |

**Slugs:** lowercase ASCII from the title, without the country suffix when it only repeats the
place, stored in `data.json` as `slug` (never generated at build time, so URLs never change
when a title is edited). Example: "Affectionate Farewell, Cap d'Antibes, France" →
`affectionate-farewell-cap-dantibes`.

### 2. Artwork page content

Each `/<medium-hub>/<slug>/index.html` contains:

- `<title>`: `<Title> — <medium>, <year> | Polina Shvedko` (≤ 60 characters; shorten the title part when needed).
- `<meta name="description">`: 120–155 characters from the first sentence of the description plus medium and size.
- `<link rel="canonical">` to its own URL; Open Graph (`og:type=article` not needed — use `website`, `og:image` = main image).
- One `h1` (the title); medium, size, year as a definition list.
- The full description from `data.json` (today hidden in the popup).
- All detail images as real `<img>` elements with `alt`, `width`, `height`, `loading="lazy"` after the first, served as WebP with JPEG fallback via `<picture>`.
- Status line without price: "Available — ask about this work" or "In a private collection" (see Open Questions).
- One contact call to action: `mailto:` link with the subject prefilled (the existing inquiry pattern), tracked as `contact_click` with `artwork_slug`.
- Previous / next artwork in the same medium, a link back to the hub, a breadcrumb.
- JSON-LD: `VisualArtwork` (`name`, `creator`, `dateCreated`, `artMedium`, `width`, `height` as `Distance`, `image`, `url` = own URL, no `offers`) and `BreadcrumbList`.

The Cap d'Antibes blog text moves into the "Story" section of
`/oil-paintings/affectionate-farewell-cap-dantibes/` **after the artist confirms the facts**
(the post is written in her voice; see Open Questions).

### 3. Hub and home pages

- **Medium hub:** `h1` (e.g. "Oil paintings by Polina Shvedko"), 100–200 words of real text about the
  medium in her work (written or approved by the artist), the grid of artworks as `<a>` cards with `<img>`
  and `alt`, `CollectionPage` + `ItemList` JSON-LD, breadcrumb.
- **Home:** `h1` with name and media, short intro, three hub sections with the latest artworks
  linking to their pages, about teaser, contact. The hero video (YouTube `ZhErK72D2R4`) loads only on
  click (facade image), not on page load.
- **Gallery filter** (`gallery-filter.js`) is no longer needed: the hubs replace it.

### 4. Remove Tilda (R2)

Delete:

- `src/css/tilda-*.css` (11 files), `src/css/fonts-tildasans.css`, the `TildaSans` webfonts.
- `src/js/tilda-*.js` (19 files), `hammer.min.js`, `w3.js`.
- All `t-*` / `tNNN__*` classes, `data-tilda-*`, `data-record-type`, `field="..."`, `rec5000730NN` IDs,
  `t_onReady`/`t_onFuncLoad` helpers and the "first visit fade-in" script in `head.html`.
- `src/templates/partials/` files are rewritten, not cleaned in place.

Replace with:

- One stylesheet `src/css/site.css` (~10–15 KB): CSS grid for cards, the existing `nav.css` rules,
  system font stack or one self-hosted variable font (WOFF2, `font-display: swap`).
- Vanilla JS only where needed: `nav.js` (kept), a ~2 KB image switcher on artwork pages
  (or no JS: show detail images stacked), `analytics.js` (rewritten, see §7).
- The `CLAUDE.md` sections "Tilda CSS gotcha" and "Tilda component IDs" are deleted.

### 5. Remove the shop (R3)

Delete:

- The cart widget `t706` and its script in `footer.html`; `analytics.js` handlers for
  `cart_order` and `purchase_inquiry`; `tilda-cart`, `tilda-products`, `tilda-catalog`, `tilda-forms*`.
- Prices: `price` field in `data.json`, price markup in `gallery_card.html` / `gallery_details.html`,
  `offers` in `structured_data.html`.
- Copy: "Available to buy online" and "Delivery across the EU" in `head.html` (unless the
  artist confirms delivery as a service — Open Questions).
- `sold: true` becomes `status: "private-collection"` (or is dropped — Open Questions).

Keep: the `mailto:` contact path (email link and per-artwork "ask about this work"). It is the
only lead path left, so `contact_click` becomes the conversion event.

### 6. Remove the blog (R4)

- Delete `src/templates/blog/`, `src/css/blog.css`, `blog_head.html`, `blog_footer.html`, `blog_posts` in `data.json`.
- 301 redirects (in the deployed `.htaccess`):
  - `/blog/` → `/`
  - `/blog/cap-dantibes/` → `/oil-paintings/affectionate-farewell-cap-dantibes/`

### 7. Build, hosting and analytics fixes from the audit

| # | Change | File(s) |
|---|---|---|
| 7.1 | New Gulp task `pages`: renders `artwork.mustache` once per artwork and `hub.mustache` once per medium into `app/<hub>/<slug>/index.html` using the `mustache` package directly | `gulpfile.js`, `src/templates/pages/` |
| 7.2 | `html` task renders only page templates; partials are not emitted (`!src/templates/partials/**`). `mirror --delete` then removes `/partials/` from the host | `gulpfile.js` |
| 7.3 | Sitemap generated from `data.json` (home, hubs, artworks, about, contact) with `lastmod`; `robots.txt` keeps the `Sitemap:` line | `gulpfile.js` |
| 7.4 | `.htaccess` moves to `src/static/` and is copied to `app/`: http → https, `www` → apex (one 301 hop), `/index.html` → `/`, blog redirects, `410` for `/partials/` | `src/static/.htaccess` |
| 7.5 | Image pipeline: WebP + JPEG at 600 / 1200 / 1920 px, `srcset`, originals kept out of `app/`. Target: home page < 3 MB, artwork page < 1.5 MB, LCP < 2.5 s at 390 px | `gulpfile.js` (`img` task), `data.json` image paths |
| 7.6 | Consent: gtag loads only after "Accept"; banner with "Accept" and "Decline" on every page; Consent Mode v2 defaults `denied`. GA4 numbers drop after this release — record the date | `head.html`, `footer.html`, `analytics.js` |
| 7.7 | `<html lang="en">` on every page; one `h1` per page | all page templates |
| 7.8 | Replace Cyrillic `х` with `x` in 25 `dimensions` values; split into numeric `width_cm`, `height_cm` for JSON-LD | `data.json` |
| 7.9 | `Person` JSON-LD on home and about, `sameAs` with Instagram, Facebook, LinkedIn, Etsy | `structured_data.html` |

### 8. Data model change (`data.json`)

```jsonc
{
  "hubs": [
    {"key": "oil", "path": "oil-paintings", "title": "Oil paintings", "intro": "…", "artworks": [ … ]}
  ],
  // artwork
  {
    "slug": "affectionate-farewell-cap-dantibes",   // new, required, stable
    "title": "Affectionate Farewell, Cap d'Antibes, France",
    "year": 2024,
    "medium": "Oil on canvas",
    "width_cm": 190, "height_cm": 45,                 // new, replaces "dimensions"
    "description": "…",
    "story": "…",                                     // optional, long text (e.g. former blog post)
    "status": "available" | "private-collection",     // replaces price / sold
    "images": [{"src": "img/gallery/picture32_1", "alt": "…"}],  // extension added by the build
    "col_class": "t-col_8"                            // removed (Tilda)
  }
}
```

`price`, `sold`, `col_class`, `clear_after`, `img_padding`, `lid`, `preview1/2`, `detail_images`
(Tilda slider indexes) are removed.

---

## Consequences

**Positive**

- 30 artwork pages + 3 hubs + about + contact = about 36 indexable URLs instead of 1.
- Each artwork can rank for its subject, place and medium, and appear in Google Images.
- Page weight drops from 76 MB to a target under 3 MB; about 950 KB of Tilda code is gone.
- Templates become plain HTML that is easy to edit; no hidden Tilda behaviour.
- Lead tracking becomes simple: one event, `contact_click`, with the artwork slug.

**Negative / risks**

- This is a rewrite of every template, not a patch. Visual design must be rebuilt in `site.css`.
  Mitigation: take screenshots of the current site first and match them at desktop and 390 px.
- New URLs start with no history. Google needs 2–6 weeks to crawl them. Search numbers before and
  after the release are not comparable for the first month.
- GA4 sessions drop after consent-before-analytics (7.6). This is expected, not a regression.
- Hub intro texts and the Cap d'Antibes story need the artist's input; pages must not be thin
  or invented (no doorway pages).
- Removing prices removes a signal that the works are for sale. If the artist sells by email,
  the status line and the contact button carry that message.

---

## Implementation plan

Each phase is a branch and a pull request; nothing is pushed to `main` (= deploy) without approval.

| Phase | Content | Effort | Depends on |
|---|---|---|---|
| 0 | Screenshots of current site (desktop, 390 px); `npm test` check script (see Verification) that fails on today's build | 2 h | — |
| 1 | Quick fixes on the current site: `.htaccess` deploy (7.4 without blog rules), partials not emitted (7.2), sitemap (7.3), `lang` + `h1` (7.7), Cyrillic `х` (7.8) | 3 h | 0 |
| 2 | Image pipeline (7.5) | 3–4 h | 0 |
| 3 | Data model (§8) + `slug` for all 30 artworks (slug list reviewed by owner) | 2 h | Owner approves slugs |
| 4 | New templates without Tilda: layout, home, hubs, artwork pages, about, contact, `site.css` (§2–4) | 2 days | 3 |
| 5 | Remove shop and blog code, add redirects (§5, §6) | 3 h | 4 |
| 6 | Consent + analytics rewrite (7.6) | 2 h | Owner approves consent text |
| 7 | Structured data (§2, 7.9), validated with the Rich Results Test | 2 h | 4 |
| 8 | Release: deploy, then re-run browser checks against the live site; owner submits sitemap in Search Console | 1 h | 1–7 |
| 9 | Measure: `/seo-report` 3 weeks after the release; compare only data dated after it | — | 8 |

Phase 1 and 2 ship value on the current site and can deploy before the rewrite.

---

## Verification

`npm test` runs a Node script over the built `app/` (no framework needed) and Playwright checks:

- Every artwork in `data.json` has `app/<hub>/<slug>/index.html` with exactly one `h1`,
  a unique `<title>` ≤ 60 chars, a description of 120–155 chars, a self-canonical, `lang="en"`.
- The sitemap lists exactly the generated pages; every sitemap URL returns 200 locally.
- No file in `app/` contains `tilda`, `t706`, `t754`, `data-tilda`, `TildaSans`, `price`, `cart`, `€`.
- No `app/partials/` and no `app/blog/` directory exists.
- No Cyrillic character in any built HTML.
- Every `<img>` has `alt`, `width`, `height`.
- No request to `googletagmanager.com` before "Accept" (Playwright).
- At 390 px: no horizontal scroll, no tap target below 24 px; home page transfer < 3 MB.
- Live site after deploy: `http://`, `www.`, `/index.html`, `/blog/`, `/blog/cap-dantibes/` each answer
  one 301 to the right URL; `/partials/head.html` answers 410.

---

## Open questions for the owner

1. **Status without price:** show "Available" / "In a private collection", or no status at all?
2. **Delivery and commissions:** are "Delivery across the EU" and "Commissions welcome" true services?
   If yes, say them on the contact page; if no, delete them.
3. **Cap d'Antibes story:** does the artist confirm the facts in the post (the postcard sketch, the
   viewpoint)? If not, the text is not published.
4. **Hub texts:** will the artist write or approve 100–200 words per medium?
5. **Imprint / privacy:** a German site needs an Impressum and a privacy policy that names GA4.
   They do not exist today. Who provides the legal text?
6. **Etsy:** the contact section links to an Etsy shop. Keep the link (selling elsewhere), or remove it too under R3?
7. **Slugs:** approve the list before Phase 3; URLs must not change after release.

---

## Owner actions outside the repository

1. After the release, submit `https://polina-shvedko.art/sitemap.xml` again in Search Console.
2. Request indexing for the home page and the three hubs (URL Inspection → Request indexing).
3. In GA4 Admin → Events, mark `contact_click` as a key event; remove `purchase_inquiry` / `cart_order` from key events if marked.
4. In GA4, add an annotation on the release date and on the consent change date.
5. Add a GA4 data filter or exploration segment to exclude the night-burst bot pattern.

---

## Implementation (branch adr-0003-seo-rebuild)

Built on the branch `adr-0003-seo-rebuild`, not merged to `main` and **not deployed**. The detailed contract was an
implementation spec derived from this ADR; this section records what was built, the defaults chosen for the open
questions, and what is left for the owner.

### Defaults chosen for the open questions

Each default lives in `data.json` or in one constant of `scripts/build-site.js`, so it can change without template work.

| # | Question | Default on the branch | Where to change it |
|---|---|---|---|
| 1 | Status without price | Artwork page: status line "Available — ask about this work" or "In a private collection". Cards keep the old red badge (same place, same style) with the text "Private collection"; available works have no badge. Old `sold: true` became `status: "private-collection"` (10 works) | `status` per artwork; texts in `STATUS` in `scripts/build-site.js` |
| 2 | Delivery and commissions | Not confirmed, so both claims are removed everywhere | `site.seo_description` / page texts |
| 3 | Cap d'Antibes story | Stored as `story_html` with `story_confirmed: false`; the "Story" section is rendered only when `story_confirmed` is `true`. Not shown today | `data.json` |
| 4 | Hub texts | Draft intros (about 125–175 words per hub) written only from facts already on the site (titles, years, sizes, media, the artist's own sentences), marked `intro_status: "draft"` | `hubs[].intro` |
| 5 | Imprint / privacy | No legal text was invented. `legal.imprint_html` and `legal.privacy_html` are `null`; the pages, their footer and banner links and their sitemap entries appear only when a text is set | `legal` |
| 6 | Etsy | The Etsy link stays in the contact section and in `Person.sameAs` (an external profile, not a shop on this site) | `site.social` |
| 7 | Slugs | Generated once by the slug rule and stored in `data.json`; listed below for approval | `slug` per artwork |

Other decisions: hub labels "Oil paintings", "Pastels", "Watercolours" (watercolour section heading "Watercolour
and ink", h1 "Watercolour and ink paintings by Polina Shvedko"); home keeps **all** artworks per hub section in
the old grid plus an "All …" link to the hub; home `h1` "Polina Shvedko Art" with the tagline "Oil paintings,
pastels & watercolours"; hero poster = the YouTube thumbnail of the video, the video (youtube-nocookie.com) loads on
click; footer link row with "Cookie settings"; custom 404 page; the old font is replaced by **Jost** (SIL OFL), the
closest of 20 open-licence candidates, with mapped weights and metrics; the old floating back-to-top button was not
rebuilt (not part of this ADR).

### Implementation tracker

| Item | Status |
|---|---|
| R1 — one page per artwork | **Done** — 30 pages `/<hub>/<slug>/` (`src/templates/pages/artwork.mustache`) |
| R2 — remove the old framework | **Done** — its CSS, JS, fonts, classes and attributes are gone; a test fails on any leftover |
| R3 — no e-shop | **Done** — no prices, cart, `Offer` or sales wording (tested); the e-mail CTA is the lead path |
| R4 — remove the blog | **Done** — `/blog/cap-dantibes/` → 301 to the Cap d'Antibes page, `/blog/**` → 301 `/` |
| §1 URL structure | **Done** — home, 3 hubs, 30 artworks, `/about/`, `/contact/`, `404.html`; `/imprint/` and `/privacy/` wait for legal text (**owner**) |
| §2 Artwork page | **Done** — title/description rules, canonical, OG, one `h1`, facts list, full description, all photos as `<picture>` (WebP + JPEG, `alt`, `width`, `height`, lazy after the first), status line, `mailto:` CTA tracked as `contact_click` with `artwork_slug`, prev/next, breadcrumb, `VisualArtwork` + `BreadcrumbList`. Story: **owner** confirms the facts |
| §3 Hubs | **Done** — `h1`, intro, all cards, `CollectionPage` + `ItemList` + `BreadcrumbList`; intro texts are drafts (**owner** approves) |
| §3 Home | **Done** — `h1` with name and media, intro + "More about me", three hub sections, about me, Instagram, contact; video facade |
| §3 Gallery filter | **Done** — removed |
| §4 Stylesheet, scripts, font | **Done** — `src/css/site.css` (34 KB, 8 KB gzipped; larger than the 10–15 KB estimate because it reproduces the old design at five breakpoints), five vanilla scripts (15 KB), Jost WOFF2 (27 KB) |
| §5 Shop removal | **Done** |
| §6 Blog removal | **Done** |
| 7.1 Page build | **Done** — `scripts/build-site.js` (`gulp pages`), deterministic, fails on bad data |
| 7.2 No partials on the host | **Done** — no `app/partials/`; `/partials/**` → 410; `lftp mirror --delete` removes the old files |
| 7.3 Sitemap | **Done** — 36 URLs with `lastmod`; `robots.txt` keeps the `Sitemap:` line |
| 7.4 `.htaccess` | **Done** — `src/static/.htaccess`, tested on Apache 2.4 (15 cases, one hop each). Plesk switches for requests nginx answers itself: **owner** |
| 7.5 Images and budgets | **Done** — 89 images → 498 variants; `app/img/` 90 MB → 67 MB, originals no longer deployed. Transfer on load: home 0.73 MB (desktop) / 1.07 MB (390 px), hubs 0.62–1.30 MB, the 30 artwork pages 0.09–0.57 MB; LCP 0.46–0.94 s at 390 px over four runs (DevTools "Fast 4G" profile); CLS 0 on every page |
| 7.6 Consent | **Done** — banner with Accept / Decline on every page, Consent Mode v2 defaults denied, GA only after Accept, withdrawal deletes `_ga*`. Banner text: **owner** approves; GA4 annotation of the release date: **owner** |
| 7.7 `lang` and `h1` | **Done** — `lang="en"`, exactly one `h1` and no skipped heading levels on every page |
| 7.8 Sizes | **Done** — numeric `width_cm` / `height_cm`; 5 swaps made from the photos need the artist's confirmation (**owner**) |
| 7.9 `Person` JSON-LD | **Done** — home and about, `sameAs` Instagram, Facebook, LinkedIn, Etsy |
| §8 Data model | **Done** — refined: `images[]` keep their file extensions and carry `alt`; `story` became `story_html` + `story_confirmed` |
| Verification | **Done** — `npm test`: 118 static, 104 browser, 15 Apache checks pass; html-validate passes; the build is byte-identical from a clean `npm ci` |
| Phase 7 — Rich Results Test | **After the release** — the build validates every JSON-LD block and the tests check the types; Google's Rich Results Test needs the live URLs |
| Phase 8 — release | **Owner** — merge to `main` (= deploy) after approval, then re-run the browser checks against the live site |
| Phase 9 — measure | **Owner** — `/seo-report` three weeks after the release |

### Owner actions before the release

1. Approve the slugs (they are URLs and must not change later):
   `oil-paintings/`: affectionate-farewell-cap-dantibes, turquoise-silence-of-the-verdon-gorge,
   whispers-of-the-coastal-wind, vibrant-cliffs-of-the-brava-coast, cala-secreta-a-costa-brava-hideaway,
   boats-in-the-bay-of-roses, evening-glow-on-the-brava-shore, sunset-in-a-honey-dream.
   `pastels/`: fishing-village, hortensien, bouquet-of-wild-flowers, hamburg-main-railway-station,
   afternoon-ride-in-the-countryside, blossoms-in-a-blue-pot, forget-me-nots-in-glass, lilacs-in-bloom,
   elegance-in-roses, winter-magic-a-goettingen-holiday-tribute.
   `watercolours/`: blossoms-at-the-biergarten, springtime-along-the-canal, golden-hour-on-the-corner,
   st-albani-in-the-afternoon, by-the-old-watermill, cafe-on-a-sunny-corner, the-street-of-timeless-charm,
   under-the-red-awning, the-corner-cafe-in-perspective, the-lone-windmill, a-quiet-stroll-in-the-park,
   sunny-village-square.
2. Confirm the sizes that were swapped to match the photos (old "W x H" → new width × height): Hortensien
   42 × 29.7, Hamburg Main Railway Station 41 × 32, Blossoms at the Biergarten 42 × 29.7, Springtime Along the
   Canal 42 × 29.7, By the Old Watermill 42 × 29.7; and the two kept as they were although the photo is portrait
   (A Quiet Stroll in the Park 30 × 21, Sunny Village Square 40 × 29.5). Winter Magic is a pair; 26.5 × 37 cm is
   taken as the size of each sheet.
3. Check two media: "Sunset in a honey dream" is listed as oil on canvas, but its description says synthetic
   paper on a wooden frame and starts with another title ("Sunset Harbor Dreams"); "Sunny Village Square" is
   listed as watercolour, its description says watercolour and ink.
4. Approve or rewrite the three hub intros (`intro_status: "draft"`).
5. Confirm the Cap d'Antibes story facts, or leave it hidden. The text says "morning light" and "the last
   morning" while the painting shows the evening, and "Antibes to the east" is doubtful.
6. Approve the consent banner text (`CONSENT_TEXT` in `scripts/build-site.js`).
7. Provide the Impressum and the privacy policy (it must name Google Analytics and the YouTube video, which loads
   from youtube-nocookie.com after a click).
8. Decide about 13 unreferenced files in `src/img/` (12.3 MB, not deployed): `IMG_2993 (1).jpg`,
   `IMG_3272 (1).jpg`, `avata.webp`, `avatar_400x400.png`, `photo_2022-12-02_18- (5).png`,
   `gallery/picture13_1_preview.jpeg`, `gallery/picture13_2_preview.jpeg`, `gallery/picture30_3_preview.jpg`,
   `gallery/picture30_4_preview.jpg`, `gallery/picture7_1.jpg`, `gallery/picture7_2.jpg`, `gallery/picture8_1.jpg`,
   `gallery/picture8_2.jpg` (the last two have the same sizes as `picture_22_1.jpg` / `picture_22_2.jpg`).

### Owner actions at and after the release

1. In Plesk (Hosting Settings): enable "Permanent SEO-safe 301 redirect from HTTP to HTTPS" and set "Preferred
   domain" to `polina-shvedko.art`. The `.htaccess` rules do the same for requests that reach Apache; these
   switches also cover files that nginx serves directly.
2. The steps in "Owner actions outside the repository" above (sitemap, indexing requests, `contact_click` as key
   event, annotations, bot filter); also register `link_location` and `artwork_slug` as event-scoped custom
   dimensions in GA4.
3. After the deploy, check the live site: `http://`, `www.`, `/index.html`, `/blog/`, `/blog/cap-dantibes/` answer
   one 301 each, `/partials/head.html` answers 410.
