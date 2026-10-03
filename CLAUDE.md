# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Portfolio website of Polina Shvedko, an artist from Germany: oil paintings, pastels and watercolours.
Plain static HTML generated from `data.json` by Node scripts run from Gulp 4 (Mustache templates, `sharp` for
images). One indexable page per artwork under three medium hubs, plus home, about, contact and a 404 page. No
framework, no shop (no prices, no cart), no blog. The architecture is described in
`ADR/ADR0003-seo-rebuild-artwork-pages.md`; ADR-0001 and ADR-0002 are history.

A push to `main` is a production deploy (`.github/workflows/deploy.yml`). Work on a branch.

## Commands

```bash
npm ci --legacy-peer-deps     # install (CI uses exactly this; a plain `npm install` keeps package-lock.json stable too)
npm run build                 # images (scripts/images.js) + whole site into app/
npm run build:site            # site only: clean app/ (keeps app/img/), copy css/fonts/js/static, render pages + sitemap (what CI runs; no sharp needed)
npm run image                 # image variants + src/img/manifest.json (gulp img; needs sharp)
npm run server-start          # gulp: build:site, watch + livereload, dev server on 0.0.0.0:7000 serving app/
npm run server-watch          # gulp watch: build:site, then rebuild on changes + livereload (no server)
npm run serve                 # dependency-free static server for app/ on http://127.0.0.1:7001 (404.html, 301 to slash)
npm test                      # test:static && test:browser && test:apache
npm run test:static           # file checks over the built app/ (fast, ~2 s)
npm run test:browser          # Playwright Chromium, desktop 1366x900 + mobile 390x844 (~3.5 min)
npm run test:apache           # .htaccess on httpd:2.4 in Docker (skips with a message without Docker)
npm run validate-html         # html-validate over app/**/*.html with .htmlvalidate.json
npm run sitemap               # alias of the pages task (the sitemap is written by build-site.js)

# Gulp tasks (npx gulp <task>)
gulp build:site | build | img | pages (aliases html, sitemap) | css | fonts | js (alias babel) | static | clean | watch | server

# Scripts
node scripts/images.js [--force | --check | --fetch-poster]   # --check = verify only, exit 1 on problems
node scripts/build-site.js [--out <dir>]                       # pages + sitemap only
node scripts/serve.js --root <dir> --port <n> [--host 0.0.0.0] [--quiet]   # port 0 = random; refuses 7000

# Docker alternative (container gulp_app, node:22, runs `npm install && npm run server-start`)
docker-compose up -d          # http://localhost:7000, livereload 35729
```

After pulling a branch that changes `package.json`, restart the container so `npm install` runs again.

### Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `APP_DIR` | gulp tasks, `build-site.js`, `images.js`, `serve.js`, all tests | output / test directory (default `app`, relative to the repo root or absolute). `clean` keeps `<APP_DIR>/img`, also when it is a symlink, and refuses dangerous values |
| `GULP_PORT`, `GULP_HOST`, `GULP_OPEN` | `gulp server` | dev server port (default 7000), address (default 0.0.0.0), `GULP_OPEN=0` = do not open a browser |
| `LIVERELOAD_PORT` | `gulp watch` | livereload port (default 35729, mapped by docker-compose) |
| `PORT` | `scripts/serve.js` | port when `--port` is not given (default 7001) |
| `SCREEN_DIR` | browser tests | screenshots, `performance.json`, `axe-warnings.json` (default `<os tmpdir>/polina-shvedko-screens/<timestamp>`) |
| `BROWSER_PAGES=all` | browser tests | visit all 36 pages at both viewports in the page-load test (default: one page per type) |
| `LCP_NETWORK` | browser tests | `fast4g` (default, DevTools "Fast 4G"), `slow4g` (Lighthouse-like) or `none` |
| `APACHE_IMAGE` | apache test | Docker image (default `httpd:2.4`) |

A private build that does not touch `app/`: `X=/some/dir; mkdir -p $X && ln -sfn $PWD/app/img $X/img && APP_DIR=$X npx gulp build:site`,
then `node scripts/serve.js --root $X --port <port>` and `APP_DIR=$X npm run test:static`. Never use port 7000 for
anything but the dev server.

## Architecture

### Build pipeline

`gulpfile.js` (Gulp 4, every task returns its stream or promise):

| Task | Does |
|---|---|
| `clean` | delete everything in `APP_DIR` except `img/` |
| `css` | `src/css/**/*.css` → `app/css/` (`site.css` is the only stylesheet) |
| `fonts` | `src/css/webfonts/**` → `app/css/webfonts/` |
| `js` (alias `babel`) | `src/js/**/*.js` → `app/js/` (copied, not transpiled; the scripts are ES5) |
| `static` | `src/static/**` incl. dotfiles (`.htaccess`, `robots.txt`) → `app/` |
| `pages` (aliases `html`, `sitemap`) | `scripts/build-site.js`: every HTML page + `sitemap.xml` |
| `img` | `scripts/images.js`: WebP/JPEG variants into `app/img/` + `src/img/manifest.json` |
| `build:site` | `clean` → parallel(`css`, `fonts`, `js`, `static`) → `pages` |
| `build` | `img` → `build:site` |
| `watch` | `build:site`, then watch `src/css`, `src/js`, `src/templates`, `src/static`, `data.json`, `src/img/manifest.json` (polling, works in Docker) |
| `server` / `default` | dev server for `app/` / `watch` then `server` |

`scripts/build-site.js` (CommonJS, `build({ root, outDir })`, also a CLI) loads `data.json` and
`src/img/manifest.json`, builds the view models, renders `src/templates/pages/*.mustache` with the partials in
`src/templates/partials/*.mustache` and writes the pages and `sitemap.xml`. It writes a file only when its content
changes, and the output is deterministic (byte-identical on every machine; no timestamps). It **throws** (exit 1) on:
a missing manifest entry for a referenced image, a duplicate or malformed slug, an unknown or incomplete hub, an
unknown status, a `<title>` over 60 characters or a duplicate title, a meta description outside 120–155 characters,
invalid JSON-LD, a missing template, stylesheet or script. Constants worth knowing (top of the file): `STATUS` texts,
`SIZES` / `ARTWORK_BOX` (the `sizes` attributes; change them together with the layout in `site.css`),
`SITE_IMAGE_ALT`, `CONSENT_TEXT`, `SOCIAL_ORDER`, `MOSAIC_TILES`, `LEGAL`.

- CSS and JS URLs carry a content hash (`/css/site.css?v=<8 hex>`), computed from `src/`.
- All asset URLs are root-relative (`/img/...`); the 404 page works at any path.
- JSON-LD is built as JS objects and serialised with `JSON.stringify` (`</` escaped). Never hand-write JSON in a
  template.

### Pages and URLs

| Page | Output | URL |
|---|---|---|
| Home | `app/index.html` | `/` |
| Hub | `app/<hub.path>/index.html` | `/oil-paintings/`, `/pastels/`, `/watercolours/` |
| Artwork | `app/<hub.path>/<slug>/index.html` | `/oil-paintings/affectionate-farewell-cap-dantibes/` |
| About / Contact | `app/about/index.html`, `app/contact/index.html` | `/about/`, `/contact/` |
| Imprint / Privacy | `app/imprint/`, `app/privacy/` | only when `legal.imprint_html` / `legal.privacy_html` is set (today both are `null`) |
| 404 | `app/404.html` | Apache `ErrorDocument`; `noindex`, no canonical, not in the sitemap |

Canonical = `https://polina-shvedko.art` + path with a trailing slash. Every page has `lang="en"`, one `h1`, a unique
`<title>` (≤ 60 characters), a meta description (120–155), canonical, Open Graph (`og:image` = absolute 1200 px JPEG
with its width/height), `twitter:card`, sticky nav, footer, consent banner and JSON-LD:
home `WebSite` + `Person` (`https://polina-shvedko.art/#person`, `sameAs` = the four social URLs); hub
`CollectionPage` + `ItemList` + `BreadcrumbList`; artwork `VisualArtwork` (no `offers`) + `BreadcrumbList`; about
`AboutPage`; contact `ContactPage`.

Artwork `<title>`: the first candidate of at most 60 characters of `<title> — <medium_label>, <year> | Polina Shvedko`,
`<title> — <medium_label> | Polina Shvedko`, `<title> | Polina Shvedko`, `<title cut at a word>… | Polina Shvedko`,
unless `seo_title` is set. Meta description (unless `seo_description`): `<title>, <medium> by Polina Shvedko (<year>),
<w> × <h> cm. <first description paragraph>`, cut at a word to ≤ 155; below 120 the status sentence is appended.

### Data (`data.json`)

- `site`: `url`, `name`, `lastmod` (sitemap `lastmod` default and footer year; set it when you publish changes),
  `email`, `ga_measurement_id` (`G-G10K54YDPQ`), `youtube_id` (hero video), `seo_title`, `seo_description`,
  `social[]` (`name`, `url`; Instagram, Facebook, LinkedIn, Etsy), `images` (`hero_poster`, `avatar`, `photo`,
  `portrait`, `og_default`).
- `pages.about`, `pages.contact`: `seo_title`, `seo_description`.
- `hubs[]` in display order: `key` (`oil`, `pastel`, `watercolour`; section id `#gallery-<key>`), `path` (URL
  folder), `label` (nav, breadcrumb, footer), `section_heading` (home h2), `h1`, `all_link`, `medium_label` (in
  artwork titles), `artform` (JSON-LD), `seo_title`, `seo_description`, `intro[]` (plain-text paragraphs),
  `intro_status` (`draft` until the artist approves), `artworks[]` (display order = order on home, hub and pager).
- Artwork: `slug` (stable URL part; **never change it after release**), `title`, `year`, `medium` (English,
  e.g. `Oil on canvas`), `surface` (JSON-LD), `width_cm`, `height_cm` (numbers, width × height), `frame` (string or
  `null`), `description[]` (plain-text paragraphs, no HTML), `status` (`available` | `private-collection`), `card`
  (`wide` | `standard`), `preview` and `preview_hover` (card image and hover image), `images[]` (`src`, `alt`; the
  first is the main image), `story_html` + `story_confirmed` (a "Story" section is rendered only when
  `story_confirmed` is `true`), `story_images[]`, optional `seo_title`, `seo_description`, `updated` (`YYYY-MM-DD`,
  sitemap `lastmod`).
- `socialmedia_images[]` (`src`, `alt`): the first five fill the Instagram mosaic on home.
- `legal`: `imprint_html`, `privacy_html` (`null` = page not generated, not linked, not in the sitemap).

Slug rule: lowercase; `ä→ae ö→oe ü→ue ß→ss`; other accents stripped; apostrophes removed; a trailing
`, France` / `, Spain` / `, Germany` dropped; every other run of characters → `-`.
Alt texts: main image `<title> — <medium> by Polina Shvedko`; further images describe what the photo shows
(`<title> — framed`, `— detail 2`, ...).

**Adding an artwork:** put the photos into `src/img/gallery/`, add the artwork object to its hub in `data.json`
(new unique `slug`), run `npm run image` (writes the variants and the manifest), then `npm run build:site` and
`npm test`. Commit `data.json`, the source photos, `src/img/manifest.json` and the changed `app/` files (variants and
pages). No template editing.

### Images (`scripts/images.js`)

- `src/img/` is the source of truth. The pipeline processes exactly the images `data.json` references (also
  `<img src>` inside `story_html`). Unreferenced files in `src/img/` are not deployed.
- Variants `app/img/<subdir>/<stem>-<w>.webp` and `.jpg` (stem = file name without extension, lowercased) at
  600 / 1200 / 1920 px, never upscaled; EXIF auto-orient, sRGB, flattened on white, no metadata; WebP q75, mozjpeg
  q75 progressive. Everything else in `app/img/` is deleted, except the icons copied as-is (`favicon.ico`,
  `avatar_152x147.png`, `avatar_270x262.png`).
- `src/img/manifest.json` (committed) holds per image the original size and every variant (`w`, `h`, `src`,
  `bytes`) plus a source digest, so CI never needs `sharp` and an unchanged image is never regenerated.
- Templates use only manifest images: `<picture>` with a WebP source and a JPEG `<img>` (`srcset`, `sizes`,
  `width`/`height` of the original, `loading="lazy"` except above-the-fold images).
- A full run takes about 70 s; a run with nothing to do about 1 s. The hero poster is the YouTube thumbnail
  (`node scripts/images.js --fetch-poster` downloads it again).

### Templates (`src/templates/`)

- `pages/`: `home`, `hub`, `artwork`, `about`, `contact`, `404`, `legal`. Each starts with `{{> head}}` (doctype,
  `<head>`, `<body class="site site--<type>">`, nav) and ends with `{{> foot}}` (footer, consent, closing tags).
- `partials/`: `head`, `nav`, `foot`, `footer`, `consent`, `breadcrumb`, `picture` (one manifest image), `card`,
  `hero`, `intro`, `gallery`, `about-me`, `instagram`, `contact`, `icon-*` (inline SVG). Partials are referenced by
  name (`{{> card}}`), no paths.
- Use `{{var}}` for text (the build's escaper keeps `/` readable) and `{{{var}}}` only for HTML the build produced
  (JSON-LD, `story_html`, `legal`). Never put Mustache tags inside a `{{! }}` comment: the first `}}` ends it.
- Class names are BEM (`card__title`, `artwork__thumb`). Hooks that JS and tests rely on: `#site-nav`
  (`site-nav--hidden` / `--visible`), `header.hero#top`, `.hero__play[data-youtube-id]`, `section.gallery#gallery-<key>`,
  `article.card > a.card__link`, `#artwork-images.artwork__main > picture[data-index]`,
  `button.artwork__thumb[data-index][aria-current]`, `.artwork__prev/.artwork__next`, `#cookie-consent`,
  `#cookie-accept`, `#cookie-decline`, `#cookie-settings`, `[data-track="contact"][data-location]`
  (+ `data-artwork-slug` on the artwork CTA). `tests/static/markup-contract.test.js` lists them all.

### CSS and font

`src/css/site.css` reproduces the look of the previous site (colours, sizes, spacing, grid, card ratios, hover image
swap, pills, sticky nav, hero, cookie bar, footer) with the old breakpoints (≥1201, 961–1200, 641–960, 481–640,
≤480). Font: **Jost** (SIL OFL 1.1, `src/css/webfonts/jost/` with `OFL.txt`), one variable WOFF2, preloaded; the
weights are mapped (300/375/425/485/565 for the old 300/400/500/600/700) and the vertical metrics overridden. Every
`*.woff2` in `src/css/webfonts/` is preloaded by the build, so do not add unused fonts. Keep `[hidden]` rules for
`.cookie-consent`, the artwork slides and the prev/next buttons (author `display` rules override the attribute).

### Behaviour (`src/js/`, vanilla ES5, deferred, no libraries)

- `consent.js` (every page; `data-ga-id` on its script tag): banner on the first visit; choice in `localStorage`
  `cookie_consent_v2` = `granted` | `denied`. Nothing is requested from Google before Accept. Accept → Consent Mode v2
  defaults denied, `update analytics_storage: granted`, then `gtag.js`. Decline or a later withdrawal → GA disabled
  and `_ga*` cookies deleted. `#cookie-settings` (footer) reopens the banner. `window.siteConsent = { status(), open() }`.
- `analytics.js` (every page): `contact_click` for every `[data-track="contact"]` click (`link_location`,
  `artwork_slug` on artwork CTAs) and `hero_video_play` (from `hero.js`), only with consent. The old events
  (`artwork_view`, `cart_order`, `purchase_inquiry`, `gallery_filter`) are gone.
- `nav.js` (every page): home shows the nav once the hero has left the viewport; other pages always.
- `hero.js` (home): the play button replaces the poster with the `youtube-nocookie.com` player (no YouTube request
  before the click).
- `artwork.js` (artwork pages): thumbnails, prev/next, arrow keys and swipe switch the main image. Without JS a
  `<noscript>` style shows all images.

### Hosting

- Production: Plesk at checkdomain.de, nginx in front of Apache. CI (`deploy.yml`) runs `npm ci --legacy-peer-deps`
  and `npx gulp build:site`, then `lftp mirror --reverse --delete ./app` over SFTP: `app/` is the whole site, and
  files missing from `app/` are deleted on the server.
- `src/static/.htaccess` (copied to `app/`): `ErrorDocument 404 /404.html`; `/blog/cap-dantibes/` → 301 to the
  Cap d'Antibes artwork page; `/blog/**` → 301 `/`; `/partials/**` → 410; `/index.html` and `/<dir>/index.html` →
  301 to the folder URL; `www` → apex and `http` → `https` (also via `X-Forwarded-Proto`), each in one hop.
  Requests that nginx answers itself (static files) never reach `.htaccess`; the Plesk settings
  "Permanent SEO-safe 301 redirect from HTTP to HTTPS" and "Preferred domain: polina-shvedko.art" cover those.
- `src/static/robots.txt` points to `https://polina-shvedko.art/sitemap.xml`.

### Tests (`tests/`, Node's built-in `node:test`, no framework)

- `tests/static/` (over the built `APP_DIR`): pages exist, meta and headings, sitemap and robots, forbidden content
  (old framework names, shop words, retired events, Cyrillic), no `partials/` or `blog/`, images (`alt`, `width`,
  `height`, ratio, WebP source, every referenced file exists), internal links and click depth, JSON-LD,
  html-validate, data model and manifest, hosting files, build determinism, the markup contract.
- `tests/browser/` (Playwright Chromium 1.63.0 from `~/.cache/ms-playwright`; every non-local request is blocked
  and recorded): page loads without errors or third-party requests, consent, navigation and the image gallery,
  contact tracking, hero facade, 390 px layout (no horizontal scroll, tap targets ≥ 24 px, text ≥ 12 px), budgets
  (home < 3 MB, artwork < 1.5 MB, LCP < 2.5 s at 390 px, CLS < 0.1), axe (no critical/serious; `color-contrast` only
  warns because the colours are the old design), custom 404, screenshots into `SCREEN_DIR`.
- `tests/apache/`: the redirect matrix on a real Apache (Docker `httpd:2.4`, `app/` mounted read-only).
- The test groups are loaded through `tests/<group>/index.js`; one file: `node --test --test-reporter=spec tests/browser/consent.test.js`.
- `.htmlvalidate.json` extends `html-validate:recommended` and `html-validate:document`; it switches no rule off.
  The reasons for its two rule options are in the header of `tests/static/html-validate.test.js`.

## Key Files

| File | Purpose |
|---|---|
| `data.json` | all content: site, page meta, hubs with artworks, Instagram images, legal texts |
| `scripts/build-site.js` | HTML pages + sitemap from `data.json` |
| `scripts/images.js` | image variants + `src/img/manifest.json` |
| `scripts/serve.js` | static server used by `npm run serve` and the tests |
| `src/templates/pages/`, `src/templates/partials/` | Mustache templates |
| `src/css/site.css` | the only stylesheet |
| `src/js/*.js` | consent, analytics, nav, hero, artwork |
| `src/static/.htaccess`, `src/static/robots.txt` | hosting files copied to `app/` |
| `.github/workflows/deploy.yml` | build + SFTP deploy on push to `main` |
| `ADR/` | decisions; `ADR0000-index.md` has the trackers |
| `.claude/commands/seo-report.md`, `scripts/seo-report.py` | `/seo-report` (Search Console + GA4) |

## Key Conventions

- Edit `src/` and `data.json`, never `app/` by hand; `app/` is generated and committed (CI does not run `sharp`).
- All visible text is English; no Cyrillic characters anywhere (a test checks it).
- No sales wording: no prices, `€`, "buy", "shop", "cart", "checkout", "sold", delivery or commission claims (tests
  check `app/`). The only lead path is e-mail (`mailto:` links tracked as `contact_click`). The Etsy profile link stays.
- Meta texts: titles ≤ 60 characters, descriptions 120–155, unique.
- Do not invent facts about the artworks or the artist (sizes, places, stories); ask the owner.
- Prefer small, deterministic builds: run `npm run build:site` and `npm test` before you commit.
- `.eslintrc.js` is a leftover (ESLint and its `babel-eslint` parser are not installed). The code uses 2-space
  indentation and single quotes (`.prettierrc`).
- `package.json` has a legacy `"name": "recipes"`: ignore it.
