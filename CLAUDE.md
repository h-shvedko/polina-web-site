# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Portfolio website for Polina Shvedko, a German artist. Static site with galleries for oil paintings, pastels, and watercolors (aquarelle). Built with Gulp, Mustache templates, and Tilda CSS framework components.

## Commands

```bash
npm install                  # Install dependencies
npm run server-start         # Dev server at http://localhost:7000 (builds + serves)
npm run server-watch         # Dev server with file watching + live reload
npm run build                # Production build to /app directory
npm run image                # Optimize images (src/img -> app/img)
npm run validate-html        # W3C HTML validation on built files
npm run sitemap              # Generate XML sitemap

# Docker alternative
docker-compose up -d         # Starts node:22 container, installs deps, runs server on :7000
```

## Architecture

**Build pipeline (gulpfile.js):** Gulp 4 compiles `src/` into `app/`. The `html` task runs Mustache templating with `data.json` as context. CSS, JS, images, and fonts are copied/processed into `app/`. All tasks must `return` their gulp streams for async completion.

**Template system:** `src/templates/index.html` is the main layout, which includes partials via `{{> partials/filename.html}}`. All partials live in `src/templates/partials/`.

**Data-driven galleries:** All artwork data lives in `data.json` with three gallery collections:
- `oil_gallery.artworks[]` (7 items)
- `pastel_gallery.artworks[]` (10 items)
- `aquarell_gallery.artworks[]` (12 items)
- `socialmedia_images[]` (29 preview images for Instagram mosaic)

Each artwork has: `lid`, `title`, `description`, `medium`, `dimensions`, `price`, `col_class`, `preview1`, `preview2`, `detail_images[]`, optional `sold: true`, optional `clear_after: true`.

**Adding a new artwork:** Add a JSON entry to the relevant gallery in `data.json`, drop images in `src/img/gallery/`, run `npm run build`. No HTML editing needed.

**Shared gallery templates:** Two reusable partials render all artworks:
- `src/templates/partials/gallery/gallery_card.html` — grid card with hover image swap, SOLD badge, price, "MORE" button
- `src/templates/partials/gallery/gallery_details.html` — popup with image slider, description, dimensions, price

Gallery page partials (`gallery_oil.html`, `gallery_pastel.html`, `gallery_aquarell.html`) loop over artworks using `{{#gallery_name}}{{#artworks}}{{> gallery/gallery_card.html}}{{/artworks}}{{/gallery_name}}`.

**Mustache escaping:** Use triple-mustache `{{{var}}}` for values containing `/` (file paths) or quotes (descriptions). Double-mustache `{{var}}` escapes `/` to `&#x2F;`, breaking CSS `url()` and `data-original` attributes.

**Column widths:** The `col_class` field controls card width: `t-col_4` (1/3 width), `t-col_8` (2/3), `t-col_12` (full width). Precomputed in JSON to avoid Mustache logic.

**Tilda CSS gotcha:** Do not wrap Tilda layout divs (`t680__tile`, `t680__bgimg_wrapper`, etc.) in `<a>` tags — it breaks CSS that relies on `position:absolute` + `padding-bottom` sizing. Use JS click handlers instead.

## Key Files

| File | Purpose |
|------|---------|
| `data.json` | All artwork data + socialmedia image pool |
| `src/templates/index.html` | Main layout (includes all partials) |
| `src/templates/partials/gallery/gallery_card.html` | Shared artwork card template |
| `src/templates/partials/gallery/gallery_details.html` | Shared artwork popup template |
| `src/templates/partials/head.html` | DOCTYPE, meta, CSS/JS loading, Google Analytics |
| `src/templates/partials/footer.html` | Cart widget, copyright, back-to-top, cookie consent |
| `TODO.md` | Feature backlog with completion status |

## Key Conventions

- Edit source files in `src/`, never edit `app/` directly (it's generated)
- Prices are in Euros (€), cart currency is EUR
- All UI text is English only (no Russian)
- Gallery items use `data-product-lid` attributes for popup linking
- Google Analytics: measurement ID `G-G10K54YDPQ` in `head.html`
- Sitemap URL: `https://polina-shvedko.art`
- Images follow pattern `picture[N]_[view].[ext]` with `_preview` suffix for thumbnails
- The dev server binds to `0.0.0.0:7000` (accessible from Docker and network)
