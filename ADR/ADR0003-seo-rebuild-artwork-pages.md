# ADR-0003: SEO Rebuild — One Page per Artwork, No Tilda, No Shop

**Date:** 2026-10-03
**Status:** Proposed
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
