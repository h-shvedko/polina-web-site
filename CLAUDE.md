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
npm run test:static           # file checks over the built app/ (about 5 s; build.test.js runs several builds into temporary folders)
npm run test:browser          # Playwright: Chromium at 1366x900 + 390x844, Firefox and WebKit in Docker (about 6 min)
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

After pulling a branch that changes `package.json`, restart the container so `npm install` runs again. The container
runs as root on a bind mount; the build scripts give what they write the owner of the checkout
(`scripts/file-owner.js`). A checkout that an older build left with root-owned files is repaired once with
`sudo chown -R "$(id -u):$(id -g)" app src/img`.

### Environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `APP_DIR` | gulp tasks, `build-site.js`, `images.js`, `serve.js`, all tests | output / test directory (default `app`, relative to the repo root or absolute). `clean` keeps `<APP_DIR>/img`, also when it is a symlink, and refuses the repository, its folders, a parent and any existing folder (other than `app`) that holds anything but a site build (the build's names, the hub folders and the files of `src/static/`; a folder whose `sitemap.xml` lists this site counts as an earlier build, so a file since removed from `src/static/` does not block it) |
| `GULP_PORT`, `GULP_HOST`, `GULP_OPEN` | `gulp server` | dev server port (default 7000), address (default 0.0.0.0), `GULP_OPEN=0` = do not open a browser |
| `LIVERELOAD_PORT` | `gulp watch` | livereload port (default 35729, mapped by docker-compose) |
| `PORT` | `scripts/serve.js` | port when `--port` is not given (default 7001) |
| `SCREEN_DIR` | browser tests | screenshots, `performance.json`, `axe-warnings.json` (default `<os tmpdir>/polina-shvedko-screens/<timestamp>`) |
| `BROWSER_PAGES=all` | browser tests | visit all 36 pages at both viewports in the page-load test (default: one page per type) |
| `LCP_NETWORK` | browser tests | `fast4g` (default, DevTools "Fast 4G"), `slow4g` (Lighthouse-like) or `none` |
| `APACHE_IMAGE` | apache test | Docker image (default `httpd:2.4`) |
| `PLAYWRIGHT_IMAGE` | browser tests (`engines.test.js`) | Docker image for Firefox and WebKit (default `mcr.microsoft.com/playwright:v<installed Playwright version>-noble`, i.e. `v1.63.0-noble`; Linux with Docker host networking; the tests skip with a message when Docker or the image is missing) |

A private build that does not touch `app/`: `X=/some/dir; mkdir -p $X && ln -sfn $PWD/app/img $X/img && APP_DIR=$X npx gulp build:site`,
then `node scripts/serve.js --root $X --port <port>` and `APP_DIR=$X npm run test:static`. Never use port 7000 for
anything but the dev server.

## Architecture

### Build pipeline

`gulpfile.js` (Gulp 4, every task returns its stream or promise):

| Task | Does |
|---|---|
| `clean` | delete everything in `APP_DIR` except `img/` (refuses a folder that is not a site build, see `APP_DIR`) |
| `css` | `src/css/**/*.css` → `app/css/` (`site.css` is the only stylesheet) |
| `fonts` | `src/css/webfonts/**` → `app/css/webfonts/` |
| `js` (alias `babel`) | `src/js/**/*.js` → `app/js/` (copied, not transpiled; the scripts are ES5) |
| `static` | `src/static/**` incl. dotfiles (`.htaccess`, `robots.txt`) → `app/` |
| `pages` (aliases `html`, `sitemap`) | `scripts/build-site.js`: every HTML page + `sitemap.xml` |
| `img` | `scripts/images.js`: WebP/JPEG variants into `app/img/` + `src/img/manifest.json` |
| `build:site` | `clean` → parallel(`css`, `fonts`, `js`, `static`) → `pages` |
| `build` | `img` → `build:site` |
| `watch` | `build:site`, then watch `src/css`, `src/js`, `src/templates`, `src/static`, `data.json`, `src/img/manifest.json` and `scripts/build-site.js` (polling, works in Docker; the build script is loaded again on every rebuild) |
| `server` / `default` | dev server for `app/` / `watch` then `server` |

`scripts/build-site.js` (CommonJS, `build({ root, outDir })`, also a CLI) loads `data.json` and
`src/img/manifest.json`, builds the view models, renders `src/templates/pages/*.mustache` with the partials in
`src/templates/partials/*.mustache` and writes the pages and `sitemap.xml`. It writes a file only when its content
changes, and the output is deterministic (byte-identical on every machine; no timestamps; templates are read with LF
and the `?v=` hashes ignore CR, so a CRLF checkout builds the same bytes). It **throws** (exit 1) on: a missing
manifest entry for a referenced image, a duplicate or malformed slug, an unknown or incomplete hub, an unknown
status, an artwork field it does not read (typo or leftover), a `<title>` over 60 characters or a duplicate title, a
meta description outside 120–155 characters, invalid JSON-LD, a missing template, stylesheet or script, and a
`{{> partial}}` that names no file in `partials/` (also inside sections the current data does not render). Constants worth knowing (top of the file): `STATUS` texts,
`SIZES` / `COVER_BOXES` / `ARTWORK_BOX` (the `sizes` attributes; change them together with the layout in
`site.css`; for images cropped with `object-fit: cover` the box width is multiplied by the image's own aspect ratio,
see `coverSizes()`), `ARTWORK_FIELDS` (the artwork data model), `SITE_IMAGE_ALT`, `CONSENT_TEXT`, `SOCIAL_ORDER`,
`MOSAIC_TILES`, `LEGAL`, the `NOSCRIPT_*` styles (pages without JavaScript).

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

Canonical = `https://polina-shvedko.art` + path with a trailing slash. Every indexable page has `lang="en"`, one `h1`
(inside `<main id="main">`), a unique `<title>` (≤ 60 characters), a meta description (120–155),
`<meta name="robots" content="max-image-preview:large">`, canonical, Open Graph (`og:image` = absolute URL of the
1200 px JPEG variant, or of the largest variant when the original is narrower, with its width/height; an artwork
page uses its main image, each hub the main image of its first artwork, so it shares the `og:image` with that
artwork page; home uses `site.images.og_default`, the Cap d'Antibes photo, so home, the oil hub and that page share
one image), `twitter:card`, a "Skip to content" link, the consent banner
(first after the skip link in the source, fixed at the bottom), sticky nav, footer and JSON-LD:
home `WebSite` + `Person` (`https://polina-shvedko.art/#person`, `sameAs` = the four social URLs); hub
`CollectionPage` + `ItemList` + `BreadcrumbList`; artwork `VisualArtwork` (no `offers`; `width`/`height` as
`QuantitativeValue` with `unitCode` `CMT`, because schema.org 30.0 made `Distance` a text type) + `BreadcrumbList`;
about `AboutPage`; contact `ContactPage`. The 404 page has `noindex` and no canonical, Open Graph or JSON-LD.

Artwork `<title>`: the first candidate of at most 60 characters of `<title> — <medium_label>, <year> | Polina Shvedko`,
`<title> — <medium_label> | Polina Shvedko`, `<title> | Polina Shvedko`, `<title cut at a word>… | Polina Shvedko`,
unless `seo_title` is set (12 of the 30 titles carry medium and year today). Meta description (unless
`seo_description`): `<title>, <medium> by Polina Shvedko (<year>), <w> × <h> cm. <first description paragraph>`; a
paragraph that opens with the title again starts with "It" instead, and a credit after the title stays as the artist
wrote it (`"Title" (Inspired by P. Molina) captures ...` -> `Inspired by P. Molina, it captures ...`). Fitted
to ≤ 155 at the last sentence end that keeps ≥ 120, else cut at a word with "…" (never after "a", "of", "St" and the
like); below 120 the status sentence is appended. Sizes and initials keep a no-break space (`keepTogether()`) in all
visible text the build writes: descriptions, hub intros, every fact (also the frame), titles in cards, `h1`,
breadcrumb and pager, the story section and the legal pages (`keepTogetherHtml()`: only the text between the tags
changes; `&times;`, `&nbsp;` and line breaks count) — a static test scans every text node of every page, and
`build.test.js` builds the story and the legal pages with sample texts to scan them too.

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
  (`wide` | `standard`), `preview` and `preview_hover` (card image and hover image; their alt is the alt of the
  `images[]` entry with the same file or the one the `_preview` crop was cut from, unless the optional `preview_alt` /
  `preview_hover_alt` is set, e.g. when the crop shows the painting without the frame of its source photo),
  `images[]` (`src`, `alt`; the first is the main image), `story_html` + `story_confirmed` (a "Story" section is
  rendered only when `story_confirmed` is `true`; its images are the `<img>` tags in `story_html`; its headings move
  below the "Story" `h2`, the highest becomes `h3`; `mailto:` links to `site.email` are tracked like the artwork
  CTA), optional `seo_title`, `seo_description`, `updated` (`YYYY-MM-DD`, sitemap `lastmod`). Any other artwork field
  fails the build (`ARTWORK_FIELDS` in `scripts/build-site.js`).
- `socialmedia_images[]` (`src`, `alt`): the first five fill the Instagram mosaic on home.
- `legal`: `imprint_html`, `privacy_html` (`null` = page not generated, not linked, not in the sitemap). The HTML is
  placed below the page `h1` as written (generated legal texts can be pasted; `normalizeHtml()` turns generator markup
  such as `<br />`, inline `style`, `<a name>` and blanks at line ends into the site's markup style, and
  `target="_blank"` links get `rel="noopener"`; the same applies to `story_html`), except that its headings move so the
  highest becomes `h2` (a text may start with its own `h1`), `mailto:` links to `site.email` get `data-track="contact"`
  and `data-location="imprint"` / `"privacy"` (other addresses, e.g. a data protection authority, stay untracked),
  and sizes and initials keep a no-break space.

Slug rule: lowercase; `ä→ae ö→oe ü→ue ß→ss`; other accents stripped; apostrophes removed; a trailing
`, France` / `, Spain` / `, Germany` dropped; every other run of characters → `-`.
Alt texts: main image `<title> — <medium> by Polina Shvedko`; further images describe what the photo shows
(`<title> — framed`, `— detail 2`, ...).

**Adding an artwork:** put the photos into `src/img/gallery/`, add the artwork object to its hub in `data.json`
(new unique `slug`), run `npm run image` (writes the variants and the manifest), then `npm run build:site` and
`npm test`. Commit `data.json`, the source photos, `src/img/manifest.json` and the changed `app/` files (variants and
pages). No template editing. (`.gitignore` ignores `*.jpeg` only in the repository root, and Python caches; a test
checks that no referenced source photo is ignored and that those generated files are.)

### Images (`scripts/images.js`)

- `src/img/` is the source of truth. The pipeline processes exactly the images `data.json` references (also
  `<img src>` inside `story_html`). Unreferenced files in `src/img/` are not deployed.
- Variants `app/img/<subdir>/<stem>-<w>.webp` and `.jpg` (stem = file name without extension, lowercased) at
  600 / 900 / 1200 / 1920 px (`SETTINGS.widths`: the SPEC's three plus 900, so a phone at DPR 1.75-2 that draws an
  image 650-750 px wide does not get the 1200 px file; no step above 1.6x, a test checks it), never upscaled, plus
  `ROLE_WIDTHS` by how `data.json` uses the image (`imageRoles()`):
  160 / 320 px for the photos of artworks with more than one image (gallery thumbnails), 2560 / 3200 px for the card
  images of a `wide` card; EXIF auto-orient, sRGB, flattened on white, no metadata; WebP q75, mozjpeg
  q75 progressive. Everything else in `app/img/` is deleted, except the icons copied as-is (`favicon.ico`,
  `avatar_152x147.png`, `avatar_270x262.png`).
- `src/img/manifest.json` (committed) holds per image the original size and every variant (`w`, `h`, `src`,
  `bytes`) plus a source digest (source bytes and encoder settings, not the widths: a new width writes only its own
  files), so CI never needs `sharp` and an unchanged image is never regenerated.
- Templates use only manifest images: `<picture>` with a WebP source and a JPEG `<img>` (`srcset`, `sizes`,
  `width`/`height` of the original, `loading="lazy"` except above-the-fold images).
- A full run takes about 70 s; a run with nothing to do about 1 s. The hero poster is the YouTube thumbnail
  (`node scripts/images.js --fetch-poster` downloads it again).

### Templates (`src/templates/`)

- `pages/`: `home`, `hub`, `artwork`, `about`, `contact`, `404`, `legal`. Each starts with `{{> head}}` (doctype,
  `<head>`, `<body class="site site--<type>">`, skip link, consent banner, nav) and ends with `{{> foot}}` (footer,
  closing tags). On home the hero is the start of `<main id="main">`.
- `partials/`: `head`, `nav`, `foot`, `footer`, `consent`, `breadcrumb`, `picture` (one manifest image), `card`,
  `hero`, `intro`, `gallery`, `about-me`, `instagram`, `contact`, `icon-*` (inline SVG). Partials are referenced by
  name (`{{> card}}`), no paths; an unknown name stops the build.
- Use `{{var}}` for text (the build's escaper keeps `/` readable) and `{{{var}}}` only for HTML the build produced
  (JSON-LD, `story_html`, `legal`). Never put Mustache tags inside a `{{! }}` comment: the first `}}` ends it.
- Class names are BEM (`card__title`, `artwork__thumb`). Hooks that JS and tests rely on: `#site-nav`
  (`site-nav--hidden` / `--visible`), `header.hero#top`, `.hero__play[data-youtube-id]`, `section.gallery#gallery-<key>`,
  `article.card > a.card__link[aria-labelledby]` (title + badge ids), `#artwork-images.artwork__main > picture[data-index]`,
  `button.artwork__thumb[data-index][aria-current]`, `.artwork__prev/.artwork__next`, `button.artwork__zoom` +
  `dialog#artwork-zoom` (full-screen view), `a.skip-link`, `#cookie-consent`, `#cookie-accept`, `#cookie-decline`,
  `#cookie-settings` (in `li.site-footer__item--settings`), `[data-track="contact"][data-location]` (`hero`, `intro`,
  `artwork`, `contact`, `footer`, `imprint`, `privacy`; + `data-artwork-slug` on artwork pages), and what `hero.js`
  inserts: `div.hero__player > iframe.hero__video`. `tests/static/markup-contract.test.js` lists them all.

### CSS and font

`src/css/site.css` reproduces the look of the previous site (colours, sizes, spacing, grid, card ratios, hover image
swap, pills, sticky nav, hero, cookie bar, footer) with the old breakpoints (≥1201, 961–1200, 641–960, 481–640,
≤480). Font: **Jost** (SIL OFL 1.1, `src/css/webfonts/jost/` with `OFL.txt`), one variable WOFF2, preloaded; the
weights are mapped (300/375/425/485/565 for the old 300/400/500/600/700) and the vertical metrics overridden. Every
`*.woff2` in `src/css/webfonts/` is preloaded by the build, so do not add unused fonts. Keep `[hidden]` rules for
`.cookie-consent`, the artwork slides and the prev/next buttons (author `display` rules override the attribute).
Additions to the old look: the open consent banner reserves its height (`html.consent-open`, `--consent-h`) at the
page end; the hero play button (new) sits 30 px above the bottom of the window, also when a short window makes the
hero taller, and above the open banner; on phones it sits at the hero bottom and, while the banner is open, in the
top corner of the hero, except in split-screen phone windows (326-479 px wide, up to 440 px tall), where it stays at
the hero bottom under the open banner; in 961-1060 px windows up to 500 px tall it always takes the top corner (see
the comments in `site.css`); the hero video (after Play) is sized from `.hero__player`, a size container as large
as the hero: the player is as wide as the 16:9 box that covers the hero and 240 px taller, so the video covers the
hero edge to edge (also when the hero is taller than the window) and the player's own title bar and logo lie outside
it, as with the old background video; touch screens (`hover: none`) never render the card hover image; below
681 px the nav row has tighter spacing, snaps to link starts (after the left fade) and fades at each edge that cuts
a label (`--fade-start` 20 px, `--fade-end` 32 px), below 641 px a long label shows its first word ("Oil"); the 404
links wrap into balanced rows (6, 3 + 3, 2 + 2 + 2, one column) and the headings that wrap are balanced; the
full-screen view (`.zoom`) copies the old popup zoom (white page, thin chevrons, cross).

### Behaviour (`src/js/`, vanilla ES5, deferred, no libraries)

- `consent.js` (every page; `data-ga-id` on its script tag): banner on the first visit; choice in `localStorage`
  `cookie_consent_v2` = `granted` | `denied`. Nothing is requested from Google before Accept. Accept → Consent Mode v2
  defaults denied, `update analytics_storage: granted`, then `gtag.js`. Decline or a later withdrawal → GA disabled
  and `_ga*` cookies deleted. `#cookie-settings` (footer) reopens the banner. `window.siteConsent = { status(), open() }`.
  While the banner is open, `<html>` has `consent-open` and `--consent-h` (its height, kept current by a ResizeObserver).
  `consent.js` and `nav.js` read layout only once the stylesheet is in use (`whenStyled()`): WebKit (Safari, every
  iOS browser) runs deferred scripts before the stylesheet in `<head>` has loaded, and a layout read then makes every
  property with a transition animate from the browser's default styles when `site.css` arrives.
- `analytics.js` (every page): `contact_click` for every `[data-track="contact"]` click (`link_location`,
  `artwork_slug` on artwork CTAs) and `hero_video_play` (from `hero.js`), only with consent. The old events
  (`artwork_view`, `cart_order`, `purchase_inquiry`, `gallery_filter`) are gone.
- `nav.js` (every page): home shows the nav once the hero has left the viewport; other pages always. An edge of the
  nav row that cuts a label gets `site-nav__links--more-start` (left) or `site-nav__links--more-end` (right), and
  `site.css` fades it; a link that gets keyboard focus (not a mouse or touch press) while cut off or under a fade
  scrolls to the row start, just after the left fade.
- `hero.js` (home): the play button inserts the `youtube-nocookie.com` player (`div.hero__player > iframe.hero__video`)
  over the poster (no YouTube request before the click; `enablejsapi=1`). The player stays transparent until it
  reports that it plays (IFrame API messages), so a blocked player leaves the poster; the same button then pauses and
  resumes it (`pauseVideo` / `playVideo`; before the player plays, it removes the player again). The player is removed
  and the button reads "Play the video" again when its page never loads (20 s, 60 s on a connection the browser
  reports as 2G: a content blocker, a firewall or no connection; Firefox and Safari send no load event then), when its page loaded but it never answers (about 10 s), or
  at once when it reports an error.
- `artwork.js` (artwork pages): thumbnails, prev/next, arrow keys and swipe switch the main image; `button.artwork__zoom`
  (over the main image, shown by the script) opens `dialog#artwork-zoom`: the current image with `sizes="100vw"`,
  previous/next, arrow keys, swipe, Escape / cross / click beside the image to close; the page then shows the image
  viewed last. The dialog (`tabindex="-1"`) takes the focus itself when it opens, so browsing with the arrow keys
  after a mouse or touch open draws no focus ring on the cross; Tab reaches the cross and the arrows. Without JS a `<noscript>` style shows all images and hides the controls that need the script (also the
  footer "Cookie settings" on every page).

### Hosting

- Production: Plesk at checkdomain.de, nginx in front of Apache. On this server nginx passes every request to Apache
  (the live responses carry Apache's size-mtime ETags, also for CSS, images, `.html` and `robots.txt`), so the
  `.htaccess` below covers every response. CI (`deploy.yml`) runs `npm ci --legacy-peer-deps`,
  `npx gulp build:site`, then `npm run test:static && node scripts/images.js --check` (a failure stops the deploy),
  then `lftp mirror --reverse --delete ./app` over SFTP: `app/` is the whole site, and files missing from `app/` are
  deleted on the server.
- `src/static/.htaccess` (copied to `app/`): `ErrorDocument 404 /404.html`; `/blog/cap-dantibes/` → 301 to the
  Cap d'Antibes artwork page; `/blog/**` → 301 `/`; `/partials/**` → 410; `/index.html` and `/<dir>/index.html` →
  301 to the folder URL; a folder without the trailing slash → 301 to the URL with it (one hop, also from `http://`
  and `www.`, instead of mod_dir's second hop); repeated slashes → 301 to one slash; `www` → apex and `http` →
  `https` (also via `X-Forwarded-Proto`), each in one hop. `Cache-Control` for what Apache serves: CSS/JS one year
  `immutable` (their URLs carry `?v=<hash>`), the font one year (give a changed font a new file name), images 30 days,
  HTML/XML/TXT `no-cache`. No Plesk setting is needed for this. Keep "Serve static files directly by nginx" off: with
  its default extension list (it includes htm, html and txt) nginx would answer `/index.html` and `/<dir>/index.html`
  with 200 instead of the tested 301, and its own headers would replace the `Cache-Control` above; if it is ever
  turned on, remove htm, html and txt from the list and set "Expires" for the remaining static files. The Plesk
  switches "Permanent SEO-safe 301 redirect from HTTP to HTTPS" and "Preferred domain" are not needed either (the
  `.htaccess` does both in one hop); if they are on, check that `curl -I http://www.polina-shvedko.art/oil-paintings`
  still answers one 301 straight to `https://polina-shvedko.art/oil-paintings/`.
- `src/static/robots.txt` points to `https://polina-shvedko.art/sitemap.xml`.

### Tests (`tests/`, Node's built-in `node:test`, no framework)

- `tests/static/` (over the built `APP_DIR`): pages exist, meta and headings, sitemap and robots, forbidden content
  (old framework names, shop words, retired events, Cyrillic), no `partials/` or `blog/`, images (`alt`, `width`,
  `height`, ratio, WebP source, every referenced file exists), internal links and click depth, JSON-LD,
  html-validate, data model and manifest (also: no step above 1.6x between variant widths, no referenced source
  photo ignored by git, generated caches ignored, `.gitattributes`: LF, binary images and fonts, `*.mp4` in Git LFS),
  hosting files, build determinism, the markup contract (incl. reading order, card link names, no-JS styles, the
  full-screen view, no breaking space in a visible size or after an initial), meta descriptions that keep a credit,
  `build.test.js` (a mistyped partial or an unknown field stops the build, the text helpers, the owner steps "confirm
  the story" and "add the legal texts" with sample texts: no breaking space, one `h1`, no skipped heading level,
  tracked `mailto:` links; CRLF checkouts build the same bytes, file ownership as root, `gulp clean` safety, a second
  private build after `src/static/` changed, `gulp watch` reloading the build script), `tools.test.js`
  (`scripts/seo-report.py`: importing it runs nothing; `main()` runs the whole report against stand-in API answers;
  skips without `python3`).
- `tests/browser/` (Playwright Chromium 1.63.0 from `~/.cache/ms-playwright`, Firefox and WebKit in Docker; every
  non-local request is blocked and recorded): page loads without errors or third-party requests, consent, navigation
  and the image gallery, contact tracking, hero facade (with stand-in players for the play/pause messages and for an
  error; a player whose page loads but never answers is removed after about 10 s, one whose page never loads after
  about 20 s, or 60 s on a 2G connection), full-screen view (also: no focus ring on the cross while browsing with the arrow keys), 390 px layout
  (no horizontal scroll, tap targets ≥ 24 px, text ≥ 12 px), `layout.test.js` (the open banner hides neither content
  nor focus, the hero play button at common and short window sizes with the banner open and closed and at
  split-screen sizes with it closed, both edges of the nav row on phones after a swipe and with keyboard focus, hero
  pill and arrow at small and short windows, the hero video after Play at 14 window sizes: no black bands, the
  player's title bar and logo outside the hero; breadcrumb, pager, headings, balanced 404 link rows from 280 to 1100
  px), `images.test.js` (every `object-fit: cover` image, the hero poster too, gets the variant of its drawn size at
  DPR 1–3, also on a DPR 2 phone; the artwork main image at Lighthouse's phone emulation and at DPR 2; touch screens
  never load hover images), `engines.test.js` (Firefox and WebKit from the Playwright Docker image, see
  `tests/lib/engines.js`; skipped with a message without Docker or the image: no CSS transition while a page loads
  with a late stylesheet, the hero video geometry, a blocked player removed), budgets (home < 3 MB, artwork < 1.5
  MB, LCP < 2.5 s at 390 px and at Lighthouse's 412 px DPR 1.75, CLS < 0.1), axe (no critical/serious;
  `color-contrast` only warns because the colours are the old design), skip link, card link names, forced colours,
  no JavaScript, custom 404, screenshots into `SCREEN_DIR`.
- `tests/apache/`: the redirect matrix on a real Apache (Docker `httpd:2.4`, `app/` mounted read-only), every https
  case twice: over a TLS listener (self-signed test certificate) and as plain HTTP with `X-Forwarded-Proto`; plus
  the `Cache-Control` headers.
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
| `scripts/file-owner.js` | gives generated files the checkout's owner when a build runs as root (dev container) |
| `src/templates/pages/`, `src/templates/partials/` | Mustache templates |
| `src/css/site.css` | the only stylesheet |
| `src/js/*.js` | consent, analytics, nav, hero, artwork |
| `src/static/.htaccess`, `src/static/robots.txt` | hosting files copied to `app/` |
| `.github/workflows/deploy.yml` | build, static checks + SFTP deploy on push to `main` |
| `ADR/` | decisions; `ADR0000-index.md` has the trackers |
| `.claude/commands/seo-report.md`, `scripts/seo-report.py` | `/seo-report` (Search Console + GA4) |

## Key Conventions

- Edit `src/` and `data.json`, never `app/` by hand; `app/` is generated and committed (CI does not run `sharp`).
- Line endings are LF everywhere (`.gitattributes`: `* text=auto eol=lf`, images and fonts binary; videos `*.mp4`
  go to Git LFS, as the owner set up). A checkout made with `core.autocrlf=true` before that rule is refreshed once,
  with a clean working tree only: `git reset --hard` discards every uncommitted change to tracked files, so commit or
  `git stash -u` first, then `git rm -r --cached . && git reset --hard` (then `git stash pop` if you stashed).
- All visible text is English; no Cyrillic characters anywhere (a test checks it).
- No sales wording: no prices, `€`, "buy", "shop", "cart", "checkout", "sold", delivery or commission claims (tests
  check `app/`). The only lead path is e-mail (`mailto:` links tracked as `contact_click`). The Etsy profile link stays.
- Meta texts: titles ≤ 60 characters, descriptions 120–155, unique.
- Do not invent facts about the artworks or the artist (sizes, places, stories); ask the owner.
- Prefer small, deterministic builds: run `npm run build:site` and `npm test` before you commit.
- `.eslintrc.js` is a leftover (ESLint and its `babel-eslint` parser are not installed). The code uses 2-space
  indentation and single quotes (`.prettierrc`).
- `package.json` has a legacy `"name": "recipes"`: ignore it.
