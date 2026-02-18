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

**Build pipeline (gulpfile.js):** Gulp 4 compiles `src/` into `app/`. The `html` task runs Mustache templating with `data.json` as context. CSS, JS, images, and fonts are copied/processed into `app/`.

**Template system:** `src/templates/index.html` is the main layout, which includes partials via `{{> partials/filename.html}}`. All partials live in `src/templates/partials/`.

**Gallery structure:** Each medium has a gallery page partial (`gallery_oil.html`, `gallery_pastel.html`, `gallery_aquarell.html`) that contains the grid layout. Individual artworks are separate files in `src/templates/partials/gallery/[medium]/`:
- `N.html` - Gallery card (thumbnail, title, price, "MORE" button)
- `N_details.html` - Popup/modal with full images, description, dimensions

Artwork IDs are numeric but not sequential (e.g., oil has 11, 13-16, 30-31).

**Styling:** Uses Tilda component CSS classes (`t754__` for galleries, `t102__` for hero, `t484__` for text sections, `t029__` for dividers). Styles are in `src/css/` and include pre-minified Tilda framework files. Do not modify the Tilda framework CSS files directly.

**Images:** Source images in `src/img/gallery/` follow the pattern `picture[N]_[view].jpg` with `_preview` suffix for thumbnails. Optimized via gulp-imagemin.

## Key Conventions

- Edit source files in `src/`, never edit `app/` directly (it's generated)
- `data.json` is the Mustache data context (currently `{}`, but templates don't use dynamic data yet)
- Prices are in Euros, artwork descriptions are in English
- Gallery items use `data-product-lid` attributes for popup linking
- The dev server binds to `0.0.0.0:7000` (accessible from Docker and network)
