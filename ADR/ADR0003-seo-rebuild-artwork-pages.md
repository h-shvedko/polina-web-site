# ADR-0003: SEO Rebuild — One Page per Artwork, No Tilda, No Shop

**Date:** 2026-10-03
**Status:** Implemented on branch adr-0003-seo-rebuild (not deployed) — see [Implementation](#implementation-branch-adr-0003-seo-rebuild)
**Supersedes:** ADR-0001 items 1.2 and 1.3 (popup and cart events) and 4.3 (blog system); ADR-0002 H2 (inquiry button in the popup), H3 (gallery filter) and the cart
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
- JSON-LD: `VisualArtwork` (`name`, `creator`, `dateCreated`, `artMedium`, `width`, `height` as `QuantitativeValue` in centimetres, `image`, `url` = own URL, no `offers`) and `BreadcrumbList`. (Written as `Distance` first; schema.org 30.0 made `Distance` a text data type, see Implementation.)

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
| 7.5 | Image pipeline: WebP + JPEG at 600 / 1200 / 1920 px, `srcset`, originals kept out of `app/`. Target: home page < 3 MB, artwork page < 1.5 MB, LCP < 2.5 s at 390 px (implemented with a 900 px step as well, see Implementation) | `gulpfile.js` (`img` task), `data.json` image paths |
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
rebuilt (not part of this ADR). Artwork `<title>`: the implementation spec turned §2 into a cascade, the first of at
most 60 characters of `<title> — <medium>, <year> | Polina Shvedko`, `<title> — <medium> | Polina Shvedko`,
`<title> | Polina Shvedko`, `<title cut at a word>… | Polina Shvedko` (`seo_title` overrides it), so the year goes
first and then the medium, before the title is shortened: today 12 titles have medium and year, 11 the medium only,
6 neither, and Cap d'Antibes has its own `seo_title` without them. Owner: say if every title should keep the medium
(the cascade can try `<title> — <medium>, <year>` without the name suffix first).

Changes after the first review round (2026-10-04), beyond the text of this ADR:

- Structured data: `width`/`height` are `{"@type": "QuantitativeValue", "value": 42, "unitCode": "CMT", "unitText": "cm"}`.
  Since schema.org 30.0 `Quantity` (the parent of `Distance`) is a data type, and the validator reported the object
  form `{"@type": "Distance", "name": "42 cm"}` as an unknown field on all 30 artwork pages.
- Images: on top of 600/1200/1920 px, the photos of artworks with more than one image get 160 and 320 px variants
  (the 40–60 px gallery thumbnails loaded 600 px files and delayed LCP on phones), and the card images of the wide
  card get 2560 and 3200 px (the card is drawn up to about 1620 CSS px wide). The `sizes` of every image cropped with
  `object-fit: cover` (cards, Instagram tiles, thumbnails) is computed from its own aspect ratio, so wide images are
  no longer upscaled. Touch screens do not download the card hover images.
- Artwork page: the full-screen view of the old popup (zoom) is back: a click or tap on the main image opens the
  image as large as the window allows, with previous/next, arrow keys, swipe and close.
- Hero: after Play, the same button pauses and resumes the video (YouTube IFrame API messages, `enablejsapi=1`), and
  the poster stays until the player reports that it plays (a blocked player no longer leaves a black hero).
- Accessibility: a "Skip to content" link, the consent banner first in the reading order, the page keeps room for
  the open banner (it no longer covers the footer or keyboard focus; the hero play button is handled in the second
  round, below), card links named by the title, the hero text before the play button in the Tab order, a visible
  border on Accept in forced colours.
- Navigation on phones: "Oil" instead of "Oil paintings" below 641 px (the full name stays for screen readers),
  tighter spacing, the row snaps to link starts and fades at the cut edge, keyboard focus scrolls a link into view.
- Meta: `max-image-preview:large` on every indexable page; generated artwork descriptions replace a repeated title
  with "It", end at a sentence when one fits, and never end on "a", "of", "St" and the like.
- Hosting: one hop also for a folder URL without the trailing slash (and through `http://`/`www.`), for
  `/blog/cap-dantibes/index.html` and for repeated slashes; `Cache-Control` for the responses Apache sends (CSS/JS one
  year, images 30 days, pages revalidated). CI runs `npm run test:static` and `images.js --check` before the upload.
- Build: a mistyped partial or an unknown artwork field stops the build; `gulp clean` refuses a folder that is not a
  site build; `gulp watch` reloads an edited build script; builds in the root-run dev container keep the
  repository owner on generated files; `.gitattributes` forces LF (the owner's checkout has `core.autocrlf=true`)
  and the `?v=` hashes ignore CR; `*.jpeg` in `.gitignore` is anchored to the root, so source photos can be added.

Changes after the second review round (2026-10-04):

- Hero play button: the first-round lift above the open banner was measured from the hero, so in short windows
  (1366x768 and 1280x800 laptops, landscape phones), where the hero is taller than the window, the button stayed
  under the banner, and on phones the lifted button sat on the Explore Artworks pill. Now the button sits 30 px above
  the bottom of the window (also with the banner closed, so short windows show it in the first screen) and above the
  open banner; on phones it sits at the hero bottom and, while the banner is open, in the top corner of the hero.
  In split-screen phone windows (about 330-480 px wide, up to 440 px tall) the title reaches that corner, so there the
  button waits under the open banner; in 961-1060 px windows up to 500 px tall it takes the top corner. Short phone
  windows keep the pill and the arrow clear of the button with the banner closed. Tested at 21 window sizes with
  the banner open and 27 with it closed, and in a scan of windows from 280 to 1960 px wide.
- Images: a 900 px step between 600 and 1200 px for every image (848 variants, `app/img/` 80.5 MiB). Phones at
  DPR 1.75-2 (Lighthouse's mobile emulation, 2x iPhones) drew a full-width image at 650-750 px and took the 1200 px
  file; "Blossoms at the Biergarten" had an LCP of 2.6 s in Lighthouse. The widths are no longer part of the image
  digest, so a new width writes only its own files.
- Navigation on phones: both edges of the scrolling row fade when they cut a label (left 20 px, right 32 px, also a
  stronger cue at 375 px); after a swipe to the end no label fragment shows a hard cut next to the logo, and links
  snap just after the left fade.
- 404 page: the six links wrap into balanced rows at every width (6, 3 + 3, 2 + 2 + 2, one column).
- Full-screen view: the dialog takes the focus itself, so the arrow keys after a mouse open draw no focus ring.
- Hero video (completed in the third round, below): a player that never answers (blocked) is removed after about 10 s and one that reports an error at
  once, so the button no longer says "Pause the video" over a still poster.
- Meta descriptions keep the credit after a repeated title ("Inspired by P. Molina, it reveals ..."); sizes and
  initials keep a no-break space in every visible text (the frame fact, titles with "St."; the story and the legal
  texts since the third round).
- Build: `gulp clean` accepts the files of `src/static/` and an earlier build of this site (its `sitemap.xml`), so a
  second private build works after `src/static/` changed; Python caches are ignored by git.

Changes after the third review round (2026-10-04):

- Hero video: after Play the video covers the hero edge to edge like the old background video. The player was the
  cover box of the window, not of the hero, so in short windows (where the hero is taller than the window) YouTube
  letterboxed the video with black bands of 20-75 px, and its title bar, channel avatar and logo showed inside the
  hero at every start, resume and loop (on landscape phones over the h1). Now the player sits in `div.hero__player`
  (a size container as large as the hero) and is as wide as the hero's 16:9 cover box and 240 px taller, so the title
  bar and the logo lie outside the hero, as with the old site's player (checked with the real player at 1920x1080,
  2560x1440, 1366x900, 1024x600, 667x375 and 390x844, also paused and resumed). Browsers without container units
  keep the earlier sizing.
- Hero video: a player whose page never loads is removed after 20 s. Firefox and Safari (every iOS browser) send
  no load event for a frame that a content blocker, a firewall or a missing connection stops, and a dropped
  connection keeps Chromium waiting for minutes, so the button said "Pause the video" over a still poster. A page
  that loads still gets about 10 s to answer.
- WebKit (Safari, every iOS browser) runs the deferred scripts before the stylesheet in `<head>` has loaded. The
  layout reads that `consent.js` (banner height) and `nav.js` (nav edge fades) added in the second round then
  computed the browser's default styles, and when `site.css` arrived the nav links, the pills and the cookie buttons
  animated from browser blue and grey and the nav slid up (17-83 transitions per page load). Both scripts now read
  layout only once the stylesheet is in use.
- Hero poster: `sizes` describes its drawn (cover-cropped) width, `(max-aspect-ratio: 16/9) 178vh, 100vw`; DPR 2
  phones had taken the 900 px file since the 900 px step (a 3.6x upscale), now they take the 1280 px file.
- Story and legal texts: confirming the story (`story_confirmed: true`) or adding the legal texts made
  `npm run test:static` fail, which stops the deploy: their sizes and initials ("190 × 45 cm", "EU-U.S. Data") had
  breaking spaces. The build now keeps them together in the text of that HTML (never in tags, attributes or
  comments), moves the headings of a legal text below the page h1 (generated legal texts start with their own
  h1), and tracks `mailto:` links to the artist there like every other one (`data-location` `imprint` / `privacy`).
  Proven with a build that confirms the story and sets both legal texts (shaped like generated ones): all static
  checks pass.
- `scripts/seo-report.py`: importing it (as `/seo-report` does to reuse `token()` and `call()`) no longer runs the
  whole report (Google API calls, the URL Inspection quota, a state file); `main()` runs it.
- Hosting: on this server nginx passes every request to Apache (the live ETags are Apache's), so the `.htaccess`
  covers every response and no Plesk setting is needed; the owner actions below say to keep "Serve static files
  directly by nginx" off.
- `.gitattributes` keeps the owner's Git LFS rule for `*.mp4` next to the line-ending rules.
- Tests: Firefox and WebKit run in Playwright's Docker image (`tests/browser/engines.test.js`); new checks for each
  item above.

### Implementation tracker

| Item | Status |
|---|---|
| R1 — one page per artwork | **Done** — 30 pages `/<hub>/<slug>/` (`src/templates/pages/artwork.mustache`) |
| R2 — remove the old framework | **Done** — its CSS, JS, fonts, classes and attributes are gone; a test fails on any leftover |
| R3 — no e-shop | **Done** — no prices, cart, `Offer` or sales wording (tested); the e-mail CTA is the lead path |
| R4 — remove the blog | **Done** — `/blog/cap-dantibes/` → 301 to the Cap d'Antibes page, `/blog/**` → 301 `/` |
| §1 URL structure | **Done** — home, 3 hubs, 30 artworks, `/about/`, `/contact/`, `404.html`; `/imprint/` and `/privacy/` wait for legal text (**owner**) |
| §2 Artwork page | **Done** — title rule as a cascade (see "Other decisions": 12 of 30 titles carry medium and year), description rule, canonical, OG, one `h1`, facts list, full description, all photos as `<picture>` (WebP + JPEG, `alt`, `width`, `height`, lazy after the first) with a full-screen view, status line, `mailto:` CTA tracked as `contact_click` with `artwork_slug`, prev/next, breadcrumb, `VisualArtwork` (sizes as `QuantitativeValue`) + `BreadcrumbList`. Story: **owner** confirms the facts |
| §3 Hubs | **Done** — `h1`, intro, all cards, `CollectionPage` + `ItemList` + `BreadcrumbList`; intro texts are drafts (**owner** approves) |
| §3 Home | **Done** — `h1` with name and media, intro + "More about me", three hub sections, about me, Instagram, contact; video facade |
| §3 Gallery filter | **Done** — removed |
| §4 Stylesheet, scripts, font | **Done** — `src/css/site.css` (45 KB, 11 KB gzipped; larger than the 10–15 KB estimate because it reproduces the old design at five breakpoints), five vanilla scripts (29 KB with the full-screen view and the video controls), Jost WOFF2 (27 KB) |
| §5 Shop removal | **Done** |
| §6 Blog removal | **Done** |
| 7.1 Page build | **Done** — `scripts/build-site.js` (`gulp pages`), deterministic, fails on bad data |
| 7.2 No partials on the host | **Done** — no `app/partials/`; `/partials/**` → 410; `lftp mirror --delete` removes the old files |
| 7.3 Sitemap | **Done** — 36 URLs with `lastmod`; `robots.txt` keeps the `Sitemap:` line |
| 7.4 `.htaccess` | **Done** — `src/static/.htaccess`, tested on Apache 2.4 with a TLS listener and with `X-Forwarded-Proto` (32 cases each, one hop each, never through `http://`) plus the `Cache-Control` headers. nginx passes every request to Apache on this server, so no Plesk setting is needed; keep "Serve static files directly by nginx" off: **owner** (see below) |
| 7.5 Images and budgets | **Done** — 89 images → 848 variants (600/900/1200/1920 + 160/320 thumbnails + 2560/3200 for the wide card); `app/img/` 90.1 MB → 84.4 MB (85.9 → 80.5 MiB), originals no longer deployed. Transfer on load: home 0.78 MB (desktop) / 0.54 MB (390 px), hubs 0.66–1.36 MB, the 30 artwork pages 0.11–0.40 MB; home after a full scroll at 390 px 4.7 MB (was 5.5 MB: touch screens no longer load hover images); LCP 0.46–0.75 s at 390 px over three runs (DevTools "Fast 4G" profile), 0.49–0.63 s at Lighthouse's phone emulation (412 px, DPR 1.75; the artwork pages load the 900 px main image); CLS 0 on every page |
| 7.6 Consent | **Done** — banner with Accept / Decline on every page, Consent Mode v2 defaults denied, GA only after Accept, withdrawal deletes `_ga*`. Banner text: **owner** approves; GA4 annotation of the release date: **owner** |
| 7.7 `lang` and `h1` | **Done** — `lang="en"`, exactly one `h1` and no skipped heading levels on every page |
| 7.8 Sizes | **Done** — numeric `width_cm` / `height_cm`; 5 swaps made from the photos need the artist's confirmation (**owner**) |
| 7.9 `Person` JSON-LD | **Done** — home and about, `sameAs` Instagram, Facebook, LinkedIn, Etsy |
| §8 Data model | **Done** — refined: `images[]` keep their file extensions and carry `alt`; `story` became `story_html` + `story_confirmed` (the story's images are the `<img>` tags in it); `col_class` became `card` (`wide` / `standard`), `preview1`/`preview2` became `preview` / `preview_hover` (+ optional `preview_alt` / `preview_hover_alt` when a crop shows something else than its source photo); added `surface`, `frame`, `seo_title`, `seo_description`, `updated`. The build fails on any other artwork field |
| Verification | **Done** — `npm test`: 147 static, 170 browser (Chromium, plus Firefox and WebKit in Playwright's Docker image), 65 Apache checks pass (third review round; browser suite run twice); html-validate passes; the build is byte-identical on rebuilds and from a checkout with `core.autocrlf=true`; a build with the story confirmed and both legal texts set passes every static check |
| Phase 7 — structured data validation | **Done for schema.org** — validator.schema.org on the built home, hub, two artwork, about and contact pages (2026-10-04): 0 errors, 0 warnings. Google's Rich Results Test also takes pasted code (Code tab) before the release, but it asks for a Google login: **owner** (of these types only `BreadcrumbList` is a Google rich result; `VisualArtwork` is not) |
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
   from youtube-nocookie.com after a click). They go into `data.json` as HTML (`legal.imprint_html`,
   `legal.privacy_html`); a generated text can be pasted as it is, also with its own `h1` and e-mail links.
8. Decide about 13 unreferenced files in `src/img/` (12.3 MB, not deployed): `IMG_2993 (1).jpg`,
   `IMG_3272 (1).jpg`, `avata.webp`, `avatar_400x400.png`, `photo_2022-12-02_18- (5).png`,
   `gallery/picture13_1_preview.jpeg`, `gallery/picture13_2_preview.jpeg`, `gallery/picture30_3_preview.jpg`,
   `gallery/picture30_4_preview.jpg`, `gallery/picture7_1.jpg`, `gallery/picture7_2.jpg`, `gallery/picture8_1.jpg`,
   `gallery/picture8_2.jpg` (the last two have the same sizes as `picture_22_1.jpg` / `picture_22_2.jpg`).

### Owner actions at and after the release

1. Plesk: nothing to switch on. On this server nginx passes every request to Apache (the live responses carry
   Apache's size-mtime ETags, also for CSS, images, `.html` and `robots.txt`), so the tested `.htaccess` covers CSS,
   JS, images and pages: one-hop redirects, pages revalidated, CSS/JS one year, images 30 days. Keep "Serve static
   files directly by nginx" (Apache & nginx Settings) off: with its default extension list, which includes htm, html
   and txt, nginx would answer `/index.html` and `/<dir>/index.html` with 200 instead of the one-hop 301 and replace
   the `Cache-Control` of the `.htaccess`. If it is ever switched on, remove htm, html and txt from the list and set
   "Expires" for the remaining static files. The switches "Permanent SEO-safe 301 redirect from HTTP to HTTPS" and
   "Preferred domain" are optional, because the `.htaccess` already does both in one hop; if they are on, check the
   hop count with the `curl` line in step 5.
2. Once, in the main checkout after the merge (it has `core.autocrlf=true`; `.gitattributes` now asks for LF), with
   a clean working tree only: `git reset --hard` discards every uncommitted change to tracked files, so commit or
   `git stash -u` first. Then `git rm -r --cached . && git reset --hard` (and `git stash pop` if you stashed), so the
   working files get LF and local builds equal CI. If the dev container already left root-owned files:
   `sudo chown -R "$(id -u):$(id -g)" app src/img`.
3. Paste the built HTML of one page per type into Google's Rich Results Test (Code tab; needs a Google login) and
   note the result in the tracker.
4. The steps in "Owner actions outside the repository" above (sitemap, indexing requests, `contact_click` as key
   event, annotations, bot filter); also register `link_location` and `artwork_slug` as event-scoped custom
   dimensions in GA4.
5. After the deploy, check the live site: `http://`, `www.`, `/index.html`, `/blog/`, `/blog/cap-dantibes/` answer
   one 301 each, `/partials/head.html` answers 410, and `curl -I http://www.polina-shvedko.art/oil-paintings` answers
   one 301 straight to `https://polina-shvedko.art/oil-paintings/`.
