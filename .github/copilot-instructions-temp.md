# Copilot Instructions - Polina Shvedko Artist Website

## Project Overview

Static portfolio website of Polina Shvedko, an artist from Germany: oil paintings, pastels and watercolours.
Plain HTML is generated from `data.json` by Node scripts run from Gulp 4 (Mustache templates). Every artwork has
its own page under a medium hub (`/oil-paintings/`, `/pastels/`, `/watercolours/`); there are also home, about,
contact and 404 pages. There is no CSS/JS framework, no shop (no prices, no cart) and no blog
(`ADR/ADR0003-seo-rebuild-artwork-pages.md`). `CLAUDE.md` is the full reference.

## Build & Development Commands

```bash
npm ci --legacy-peer-deps   # install
npm run build:site          # site into app/ (clean, copy css/fonts/js/static, render pages + sitemap)
npm run build               # image variants + site
npm run image               # image variants + src/img/manifest.json (needs sharp)
npm run server-start        # build, watch + livereload, dev server on http://localhost:7000
npm run server-watch        # build, then rebuild on changes (no server)
npm run serve               # static server for app/ on http://127.0.0.1:7001
npm test                    # static checks, Playwright browser checks, Apache redirect checks (Docker)
npm run validate-html       # html-validate over app/**/*.html

# Docker (node:22; ports 7000 and 35729)
docker-compose up -d
```

## Architecture

- **`src/`** and **`data.json`** are the sources; **`app/`** is generated (and committed, because CI does not
  process images). Never edit `app/` by hand.
- `scripts/build-site.js` renders `src/templates/pages/*.mustache` (home, hub, artwork, about, contact, 404, legal)
  with the partials in `src/templates/partials/*.mustache` and writes `app/**/index.html` and `app/sitemap.xml`.
  It stops with an error on a missing image variant, a duplicate slug, a title over 60 characters, a meta
  description outside 120-155 characters or invalid JSON-LD.
- `scripts/images.js` writes WebP and JPEG variants (600/1200/1920 px) of every image that `data.json` references
  into `app/img/` and records them in `src/img/manifest.json`. Templates use only manifest images, in `<picture>`.
- `src/css/site.css` is the only stylesheet (BEM class names; self-hosted Jost font in `src/css/webfonts/jost/`).
- `src/js/`: `consent.js` (cookie banner; Google Analytics loads only after Accept), `analytics.js`
  (`contact_click`, `hero_video_play`), `nav.js` (sticky nav), `hero.js` (video on click), `artwork.js`
  (image switcher). Vanilla ES5, deferred, no libraries.
- `src/static/.htaccess` and `robots.txt` are copied to `app/` (redirects: http -> https, www -> apex,
  `/index.html` -> folder, retired `/blog/` URLs -> 301, `/partials/` -> 410).

### Adding an artwork

1. Put the photos into `src/img/gallery/`.
2. Add the artwork object to its hub in `data.json` (`slug`, `title`, `year`, `medium`, `surface`, `width_cm`,
   `height_cm`, `frame`, `description[]`, `status`, `card`, `preview`, `preview_hover`, `images[]` with `alt`).
3. `npm run image`, then `npm run build:site` and `npm test`.

## Code Conventions

- 2-space indentation, single quotes (`.prettierrc`). `.eslintrc.js` is not used (ESLint is not installed).
- English only in visible text; no Cyrillic characters; no prices or sales wording.
- Slugs are stable URLs: never change one after release.
- Do not invent facts about artworks or the artist.

## Deployment

A push to `main` runs `.github/workflows/deploy.yml`: `npm ci --legacy-peer-deps`, `npx gulp build:site`, then an
SFTP mirror of `app/` to the Plesk host (files missing from `app/` are deleted on the server).
